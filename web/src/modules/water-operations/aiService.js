// ARCA · Análisis con IA (Gemini, Interactions API) para el reporte de Estadísticas.
// Regla agéntica: la IA SIEMPRE responde con la estructura de REPORT_SCHEMA (salida JSON
// forzada por la API). Después se valida; si algo no cumple, se le pide corregirlo y, si
// sigue mal, se intenta con otro modelo. Nunca se acepta texto suelto.
const API_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
// Razonamiento mínimo donde el modelo lo admite: responde en segundos y la validación cuida la calidad
const MODELS = [
  { name: 'gemini-3-flash-preview', thinking: 'minimal' },
  { name: 'gemini-3.5-flash', thinking: 'minimal' },
  { name: 'gemini-3.8-flash', thinking: 'low' },
];
const API_KEY = import.meta.env.VITE_GEMINI_API_KEY;
const ATTEMPTS_PER_MODEL = 2;
// Tiempo máximo total del análisis; si se agota, el reporte se genera con los datos calculados
const TOTAL_TIMEOUT_MS = 60000;
const CALL_TIMEOUT_MS = 40000;

export const aiAvailable = () => Boolean(API_KEY);

const LEVELS = ['Bajo', 'Medio', 'Alto', 'Crítico'];
const DEADLINES = ['Inmediato', '24 horas', 'Esta semana'];

// Estructura obligatoria del reporte
const REPORT_SCHEMA = {
  type: 'object',
  properties: {
    titulo: { type: 'string', description: 'Título formal del reporte' },
    nivel_alerta_general: { type: 'string', enum: LEVELS },
    resumen_ejecutivo: { type: 'string', description: '3 a 5 oraciones con la situación general' },
    diagnostico_por_sector: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          sector: { type: 'string' },
          reportes: { type: 'integer' },
          abiertos: { type: 'integer' },
          nivel_riesgo: { type: 'string', enum: LEVELS },
          diagnostico: { type: 'string' },
        },
        required: ['sector', 'reportes', 'abiertos', 'nivel_riesgo', 'diagnostico'],
      },
    },
    prioridades: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          orden: { type: 'integer' },
          incidencia: { type: 'string' },
          sector: { type: 'string' },
          motivo: { type: 'string' },
          accion_inmediata: { type: 'string' },
        },
        required: ['orden', 'incidencia', 'sector', 'motivo', 'accion_inmediata'],
      },
    },
    recomendaciones_tandeo: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          accion: { type: 'string' },
          sector: { type: 'string' },
          plazo: { type: 'string', enum: DEADLINES },
          responsable: { type: 'string' },
        },
        required: ['accion', 'sector', 'plazo', 'responsable'],
      },
    },
  },
  required: ['titulo', 'nivel_alerta_general', 'resumen_ejecutivo', 'diagnostico_por_sector', 'prioridades', 'recomendaciones_tandeo'],
};

const RULES = `REGLAS OBLIGATORIAS DEL REPORTE (no negociables):
1. Responde únicamente con el objeto JSON del esquema. Nada de texto libre, markdown ni explicaciones fuera del JSON.
2. Usa solo los datos proporcionados. No inventes cifras, sectores, colonias ni incidencias.
3. "diagnostico_por_sector": una fila por CADA sector de la lista, con sus conteos exactos (aunque tenga 0 reportes).
4. "prioridades": solo incidencias abiertas, de la más urgente a la menos urgente (orden 1, 2, 3...). Si no hay abiertas, lista vacía.
5. "recomendaciones_tandeo": de 2 a 5 acciones concretas y verificables para la operación del suministro.
6. Redacción profesional, en español, breve y directa.`;

function buildInput(data, feedback) {
  const sectorName = (id) => data.sectors.find((s) => s.id === id)?.name || 'Sin sector';
  const incidencias = data.reports.slice(0, 80).map((r) => ({
    tipo: data.typeName(r.type),
    origen: r.source === 'proteccion-civil' ? 'Protección Civil' : 'Ciudadanía/Operaciones',
    sector: sectorName(r.sectorId),
    colonia: r.colonia || '',
    estado: r.status || '',
    nivel: r.level || '',
    descripcion: String(r.description || '').slice(0, 160),
  }));
  const avisos = data.notices.slice(0, 20).map((n) => ({ titulo: n.title, sector: sectorName(n.sectorId), nivel: n.level }));
  return [
    'Eres analista del Departamento de Operaciones de agua de Veracruz – Boca del Río (sistema ARCA).',
    'Elabora el reporte de diagnóstico del suministro y tandeo para el administrador de la red.',
    RULES,
    `Sectores: ${JSON.stringify(data.sectors.map((s) => s.name))}`,
    `Estadísticas: ${JSON.stringify(data.stats)}`,
    `Incidencias registradas: ${JSON.stringify(incidencias)}`,
    `Avisos publicados recientes: ${JSON.stringify(avisos)}`,
    feedback ? `TU RESPUESTA ANTERIOR NO CUMPLIÓ LAS REGLAS. Corrige esto: ${feedback}` : '',
  ].filter(Boolean).join('\n\n');
}

// Revisa que el reporte cumpla la estructura y los datos reales. Devuelve la lista de problemas.
export function validateReport(report, data) {
  const problems = [];
  const text = (value) => typeof value === 'string' && value.trim().length > 0;
  if (!report || typeof report !== 'object') return ['la respuesta no es un objeto JSON'];
  if (!text(report.titulo)) problems.push('falta "titulo"');
  if (!LEVELS.includes(report.nivel_alerta_general)) problems.push('"nivel_alerta_general" inválido');
  if (!text(report.resumen_ejecutivo)) problems.push('falta "resumen_ejecutivo"');

  const sectors = Array.isArray(report.diagnostico_por_sector) ? report.diagnostico_por_sector : null;
  if (!sectors) problems.push('falta "diagnostico_por_sector"');
  else {
    const names = new Set(data.sectors.map((s) => s.name));
    const missing = data.sectors.filter((s) => !sectors.some((row) => row.sector === s.name)).map((s) => s.name);
    if (missing.length) problems.push(`faltan sectores en el diagnóstico: ${missing.join(', ')}`);
    sectors.forEach((row) => {
      if (!names.has(row.sector)) problems.push(`sector inexistente: "${row.sector}"`);
      const real = data.reports.filter((r) => data.sectors.find((s) => s.name === row.sector)?.id === r.sectorId).length;
      if (names.has(row.sector) && row.reportes !== real) problems.push(`"${row.sector}" tiene ${real} reportes, no ${row.reportes}`);
      if (!LEVELS.includes(row.nivel_riesgo) || !text(row.diagnostico)) problems.push(`fila incompleta del sector "${row.sector}"`);
    });
  }
  if (!Array.isArray(report.prioridades)) problems.push('falta "prioridades"');
  else if (report.prioridades.some((p) => !text(p.incidencia) || !text(p.accion_inmediata))) problems.push('hay prioridades incompletas');
  if (!Array.isArray(report.recomendaciones_tandeo) || report.recomendaciones_tandeo.length < 1) problems.push('faltan "recomendaciones_tandeo"');
  else if (report.recomendaciones_tandeo.some((r) => !text(r.accion) || !DEADLINES.includes(r.plazo))) problems.push('hay recomendaciones incompletas');
  return problems;
}

async function ask({ name, thinking }, input, timeoutMs) {
  const response = await fetch(API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': API_KEY },
    body: JSON.stringify({
      model: name,
      input,
      response_format: { type: 'text', mime_type: 'application/json', schema: REPORT_SCHEMA },
      generation_config: { thinking_level: thinking },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error?.message || `HTTP ${response.status}`);
  const text = (result.steps || [])
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => step.content || [])
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('');
  return JSON.parse(text);
}

// Devuelve { report, model } con un reporte válido, o lanza un error si ningún modelo lo logró
export async function generateTandeoReport(data) {
  if (!API_KEY) throw new Error('Falta VITE_GEMINI_API_KEY');
  let lastError;
  const deadline = Date.now() + TOTAL_TIMEOUT_MS;
  for (const model of MODELS) {
    let feedback = '';
    for (let attempt = 0; attempt < ATTEMPTS_PER_MODEL; attempt += 1) {
      const remaining = deadline - Date.now();
      if (remaining < 5000) throw lastError || new Error('La IA tardó demasiado en responder');
      try {
        const report = await ask(model, buildInput(data, feedback), Math.min(CALL_TIMEOUT_MS, remaining));
        const problems = validateReport(report, data);
        if (!problems.length) return { report, model: model.name };
        feedback = problems.join('; ');
        lastError = new Error(`Reporte inválido (${model.name}): ${feedback}`);
      } catch (error) {
        lastError = error;
        // Saturación momentánea: se reintenta una vez el mismo modelo tras una pausa breve
        if (/high demand|overloaded|unavailable/i.test(error.message) && attempt < ATTEMPTS_PER_MODEL - 1) {
          await new Promise((resolve) => setTimeout(resolve, 1500));
          continue;
        }
        break; // sin respuesta útil: se pasa al siguiente modelo
      }
    }
  }
  throw lastError;
}
