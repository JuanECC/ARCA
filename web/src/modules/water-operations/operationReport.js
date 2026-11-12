// ARCA · Reporte de estadísticas estructurado (se guarda en Firestore y se consulta en tablas).
// Las cifras, el detalle de incidencias y los metadatos salen de los datos reales;
// la IA solo aporta el análisis (resumen, diagnóstico, prioridades y recomendaciones).
// Sin IA, el reporte se genera igual con el diagnóstico calculado de los datos.

export const MAX_INCIDENTS = 300;
export const MAX_NOTICES = 100;

const toDate = (r) => r.creadoEn?.toDate?.() || (r.createdAt ? new Date(r.createdAt) : null);
const iso = (date) => (date && !Number.isNaN(date.getTime()) ? date.toISOString() : '');
const text = (value, max) => String(value ?? '').slice(0, max);

// Diagnóstico calculado de los datos, para cuando no hay IA
function computedAnalysis({ reports, sectors, typeName, isOpen }) {
  const sectores = sectors.map((s) => {
    const list = reports.filter((r) => r.sectorId === s.id);
    const abiertos = list.filter(isOpen).length;
    return {
      sector: s.name,
      reportes: list.length,
      abiertos,
      nivel_riesgo: '—',
      diagnostico: list.length ? `${abiertos} de ${list.length} reportes siguen abiertos.` : 'Sin reportes registrados.',
    };
  });
  const prioridades = reports.filter(isOpen).map((r, i) => ({
    orden: i + 1,
    incidencia: `${typeName(r.type)}${r.colonia ? ` · ${r.colonia}` : ''}`,
    sector: sectors.find((s) => s.id === r.sectorId)?.name || 'Sin sector',
    motivo: `Estado: ${r.status || 'sin estado'}`,
    accion_inmediata: '—',
  }));
  return { diagnostico_por_sector: sectores, prioridades, recomendaciones_tandeo: [] };
}

export function buildOperationReport({ ai, model, error, operator, stats, reports, notices, sectors, typeName, isOpen }) {
  const now = new Date();
  const analysis = ai || computedAnalysis({ reports, sectors, typeName, isOpen });
  const sectorName = (id) => sectors.find((s) => s.id === id)?.name || 'Sin sector';
  const dates = reports.map(toDate).filter(Boolean).sort((a, b) => a - b);
  const byDate = (a, b) => (toDate(b) || 0) - (toDate(a) || 0);

  return {
    folio: `ARCA-OP-${now.toISOString().replace(/\D/g, '').slice(0, 12)}`,
    titulo: text(ai?.titulo || 'Reporte de estadísticas del suministro y tandeo', 200),
    metodo: ai ? 'ia' : 'calculo',
    modelo: ai ? text(model, 60) : '',
    errorIA: ai ? '' : text(error, 200),
    generadoPor: text(operator || 'Operador', 80),
    periodo: { desde: iso(dates[0]), hasta: iso(dates.at(-1)) },
    registros: { incidencias: reports.length, avisos: notices.length, sectores: sectors.length },
    indicadores: {
      reportes: stats.reportes,
      abiertos: stats.abiertos,
      ultimas24h: stats.ultimas24h,
      avisos: notices.length,
      horasHastaAvisar: String(stats.horasHastaAvisar),
    },
    nivelAlerta: ai?.nivel_alerta_general || '',
    resumen: text(ai?.resumen_ejecutivo, 2000),
    sectores: analysis.diagnostico_por_sector.map((r) => ({
      sector: text(r.sector, 80), reportes: r.reportes, abiertos: r.abiertos,
      riesgo: text(r.nivel_riesgo, 20), diagnostico: text(r.diagnostico, 500),
    })),
    prioridades: analysis.prioridades.slice(0, 50).map((p) => ({
      orden: p.orden, incidencia: text(p.incidencia, 160), sector: text(p.sector, 80),
      motivo: text(p.motivo, 400), accion: text(p.accion_inmediata, 400),
    })),
    recomendaciones: analysis.recomendaciones_tandeo.map((r) => ({
      accion: text(r.accion, 400), sector: text(r.sector, 80), plazo: text(r.plazo, 20), responsable: text(r.responsable, 120),
    })),
    incidencias: [...reports].sort(byDate).slice(0, MAX_INCIDENTS).map((r) => ({
      fecha: iso(toDate(r)),
      tipo: text(typeName(r.type), 60),
      origen: r.source === 'proteccion-civil' ? 'Protección Civil' : 'Ciudadanía/Operaciones',
      sector: text(sectorName(r.sectorId), 80),
      colonia: text(r.colonia || '—', 100),
      estado: text(r.status || '—', 30),
      descripcion: text(r.description || '—', 200),
    })),
    avisos: [...notices].sort(byDate).slice(0, MAX_NOTICES).map((n) => ({
      fecha: iso(toDate(n)),
      titulo: text(n.title || '—', 160),
      sector: n.audience === 'todos' ? 'Toda la ciudadanía' : text(sectorName(n.sectorId), 80),
      nivel: text(n.level || '—', 30),
    })),
  };
}
