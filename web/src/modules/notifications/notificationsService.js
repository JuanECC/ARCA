// ARCA · Notificaciones. Se derivan de las colecciones que ya existen en Firestore
// (notices, reportes, systemReports); no crea colecciones nuevas.
import { auth } from '../auth/firebase';
import { collection, getFirestore, onSnapshot, query, where } from 'firebase/firestore';
import { watchAssignedJobs } from '../maintenance-crew/cuadrillasService';

const db = auth?.app ? getFirestore(auth.app) : null;
const docs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

// Acepta Timestamp de Firestore, texto ISO o Date
const toMs = (value) => value?.toMillis?.() ?? (value ? new Date(value).getTime() || 0 : 0);

const LEVEL_TONE = { critico: 'error', alto: 'warning', medio: 'primary' };

const REPORT_STATES = {
  'en-revision': { label: 'En revisión por Operaciones', icon: 'manage_search', tone: 'primary' },
  'en-reparacion': { label: 'Una cuadrilla lo está atendiendo', icon: 'engineering', tone: 'warning' },
  reparado: { label: 'La cuadrilla terminó la reparación', icon: 'task_alt', tone: 'success' },
  resuelto: { label: 'Resuelto', icon: 'verified', tone: 'success' },
};

// Fuentes por rol: cada una escucha Firestore y convierte sus documentos en notificaciones
// { id, title, body, icon, tone, at }
const SOURCES = {
  citizen: ({ uid, sectorId }) => [
    // Avisos para su sector o para todos (incluye alertas de Protección Civil)
    (emit, fail) => onSnapshot(collection(db, 'notices'), (snap) => emit(
      docs(snap)
        .filter((n) => n.audience === 'todos' || (sectorId && n.sectorId === sectorId))
        .map((n) => ({
          id: `notice:${n.id}`,
          title: n.title || 'Aviso',
          body: n.message || '',
          icon: n.kind === 'alerta-proteccion-civil' ? 'warning' : 'campaign',
          tone: LEVEL_TONE[n.level] || 'primary',
          at: toMs(n.creadoEn ?? n.createdAt),
        })),
    ), fail),
    // Cambios de estado de sus propios reportes
    (emit, fail) => onSnapshot(query(collection(db, 'reportes'), where('usuarioUid', '==', uid)), (snap) => emit(
      docs(snap)
        .filter((r) => REPORT_STATES[r.estado])
        .map((r) => ({
          id: `reporte:${r.id}:${r.estado}`,
          title: `Tu reporte: ${r.titulo || 'Reporte ciudadano'}`,
          body: REPORT_STATES[r.estado].label,
          icon: REPORT_STATES[r.estado].icon,
          tone: REPORT_STATES[r.estado].tone,
          at: toMs(r.actualizadoEn ?? r.creadoEn),
        })),
    ), fail),
  ],

  'water-operator': () => [
    (emit, fail) => onSnapshot(query(collection(db, 'reportes'), where('estado', '==', 'pendiente')), (snap) => emit(
      docs(snap).map((r) => ({
        id: `reporte:${r.id}:pendiente`,
        title: 'Nuevo reporte ciudadano',
        body: r.titulo || r.descripcion || '',
        icon: 'report',
        tone: 'warning',
        at: toMs(r.creadoEn),
      })),
    ), fail),
    (emit, fail) => onSnapshot(collection(db, 'systemReports'), (snap) => emit(
      docs(snap).flatMap((r) => {
        if (r.source === 'proteccion-civil' && r.status === 'nuevo') {
          return [{
            id: `pc:${r.id}:nuevo`,
            title: 'Alerta de Protección Civil por publicar',
            body: r.colonia || r.description || '',
            icon: 'shield',
            tone: LEVEL_TONE[r.level] || 'error',
            at: toMs(r.creadoEn ?? r.createdAt),
          }];
        }
        if (r.source !== 'proteccion-civil' && r.status === 'terminado') {
          return [{
            id: `trabajo:${r.id}:terminado`,
            title: 'Una cuadrilla terminó un trabajo',
            body: [r.colonia, r.workDone?.note].filter(Boolean).join(' · '),
            icon: 'task_alt',
            tone: 'success',
            at: toMs(r.workDone?.at ?? r.actualizadoEn),
          }];
        }
        return [];
      }),
    ), fail),
  ],

  'civil-protection': () => [
    (emit, fail) => onSnapshot(query(collection(db, 'systemReports'), where('source', '==', 'proteccion-civil')), (snap) => emit(
      docs(snap).flatMap((r) => [
        r.status === 'publicado' && {
          id: `pc:${r.id}:publicado`,
          title: 'Alerta publicada a la ciudadanía',
          body: [r.alert?.title, r.alert?.by].filter(Boolean).join(' · '),
          icon: 'campaign',
          tone: 'primary',
          at: toMs(r.alert?.at ?? r.actualizadoEn),
        },
        r.closure && {
          id: `pc:${r.id}:controlado`,
          title: 'Riesgo controlado',
          body: [r.colonia, r.closure.note].filter(Boolean).join(' · '),
          icon: 'verified_user',
          tone: 'success',
          at: toMs(r.closure.at),
        },
      ].filter(Boolean)),
    ), fail),
  ],

  // Mismo filtro que usa el panel de cuadrillas, para respetar las reglas de Firestore
  'maintenance-crew': () => [
    (emit, fail) => watchAssignedJobs((jobs) => emit(
      jobs
        .filter((j) => j.status === 'asignado' && !j.assignment?.progress)
        .map((j) => ({
          id: `trabajo:${j.id}:asignado`,
          title: 'Nuevo trabajo asignado',
          body: [j.colonia, j.assignment?.crew].filter(Boolean).join(' · '),
          icon: 'engineering',
          tone: 'warning',
          at: toMs(j.assignment?.at ?? j.creadoEn),
        })),
    ), fail),
  ],
};

// Escucha las notificaciones del rol y entrega la lista combinada (más recientes primero).
export function subscribeNotifications(role, context, callback, onError) {
  const build = SOURCES[role];
  if (!db || !build || !context.uid) return () => {};

  const latest = [];
  const unsubscribers = build(context).map((listen, index) => {
    latest[index] = [];
    return listen((items) => {
      latest[index] = items;
      callback(latest.flat().sort((a, b) => b.at - a.at).slice(0, 50));
    }, onError);
  });
  return () => unsubscribers.forEach((unsubscribe) => unsubscribe?.());
}
