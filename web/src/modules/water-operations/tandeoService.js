// ARCA · Datos compartidos de tandeo (Firestore, no localStorage).
// No cambia autenticación: reutiliza auth.app.
import { auth } from '../auth/firebase';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getFirestore, onSnapshot,
  query, serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';

const db = auth?.app ? getFirestore(auth.app) : null;
const requireUser = () => {
  if (!db || !auth?.currentUser) throw Error('Inicia sesión para continuar.');
  return auth.currentUser;
};
const collections = {
  sectors: 'sectors', schedule: 'schedule', reports: 'systemReports',
  notices: 'notices', status: 'sectorStatus',
};
const asArray = (snap) => snap.docs.map((item) => ({ id: item.id, ...item.data() }));
const watch = (name, callback, onError) => {
  if (!db) { onError?.(Error('Firebase no configurado.')); return () => {}; }
  return onSnapshot(collection(db, collections[name]), (snapshot) => callback(asArray(snapshot)), onError);
};
export const watchSectors = (cb, err) => watch('sectors', cb, err);
export const watchSchedule = (cb, err) => watch('schedule', cb, err);
export const watchNotices = (cb, err) => watch('notices', cb, err);
export const watchSystemReports = (cb, err) => watch('reports', cb, err);
export const watchSectorStatus = (cb, err) => watch('status', cb, err);
export const watchCitizenReports = (cb, err) => {
  if (!db) return () => {};
  return onSnapshot(collection(db, 'reportes'), (snap) => cb(asArray(snap)), err);
};
export const formatDateKey = (value) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export async function saveSector(input) {
  requireUser();
  const name = String(input.name || '').trim();
  const colonias = String(input.colonias || '').trim();
  if (name.length < 3 || name.length > 100 || colonias.length < 3 || colonias.length > 500)
    throw Error('Indica nombre (3–100 caracteres) y colonias (3–500).');
  if (input.id) {
    await updateDoc(doc(db, 'sectors', input.id), { name, colonias, actualizadoEn: serverTimestamp() });
  } else {
    await addDoc(collection(db, 'sectors'), { name, colonias, active: true, creadoEn: serverTimestamp(), actualizadoEn: serverTimestamp() });
  }
}
export async function setSectorActive(id, active) {
  requireUser();
  await updateDoc(doc(db, 'sectors', id), { active, actualizadoEn: serverTimestamp() });
}
export async function saveDay(sectorId, date, day) {
  requireUser();
  if (!sectorId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw Error('Sector o fecha no válido.');
  const { status, from, to, note } = day;
  if (!['continuo', 'parcial', 'corte'].includes(status)) throw Error('Estado inválido.');
  if (status === 'parcial' && (!/^\d{2}:\d{2}$/.test(from) || !/^\d{2}:\d{2}$/.test(to) || from >= to))
    throw Error('El horario parcial no es válido.');
  await setDoc(doc(db, 'schedule', `${sectorId}_${date}`), {
    sectorId, fecha: date, status,
    from: status === 'corte' ? '' : (status === 'continuo' ? '00:00' : from),
    to: status === 'corte' ? '' : (status === 'continuo' ? '23:59' : to),
    note: String(note || '').slice(0, 400), actualizadoEn: serverTimestamp(),
  });
}
export async function removeDay(sectorId, date) {
  requireUser();
  await deleteDoc(doc(db, 'schedule', `${sectorId}_${date}`));
}
export async function saveOperationalReport(input) {
  const user = requireUser();
  if (!input.sectorId || !input.position || !input.photo) throw Error('Selecciona sector, punto del mapa y fotografía.');
  if (!/^data:image\/(webp|jpeg);base64,/.test(input.photo) || input.photo.length > 170000)
    throw Error('La fotografía debe estar comprimida (máximo 170 mil caracteres).');
  const reporterName = String(input.reporterName || '').trim();
  if (!reporterName) throw Error('No se pudo identificar al operador.');
  await addDoc(collection(db, 'systemReports'), {
    source: 'operaciones', sectorId: input.sectorId, type: input.type,
    colonia: String(input.colonia || '').slice(0, 100),
    description: String(input.description || '').slice(0, 1500),
    position: { lat: Number(input.position.lat), lng: Number(input.position.lng) },
    photos: [input.photo], status: 'nuevo',
    reporter: `Departamento de Operaciones · ${reporterName}`,
    createdBy: user.uid, creadoEn: serverTimestamp(),
  });
}
export async function incorporateCitizenReport(report, sectorId) {
  requireUser();
  if (!report?.id || !sectorId || !report.fotoBase64 || !report.ubicacion) throw Error('Se requiere evidencia y ubicación para asignar el reporte.');
  const ref = doc(db, 'systemReports', `ciudadano_${report.id}`);
  if ((await getDoc(ref)).exists()) throw Error('Este reporte ya fue incorporado a Operaciones.');
  await setDoc(ref, {
    source: 'ciudadano', citizenReportId: report.id,
    sectorId, type: report.tipo === 'fuga' ? 'fuga' : 'drenaje',
    colonia: String(report.titulo || '').slice(0, 100), description: String(report.descripcion || ''),
    position: report.ubicacion, photos: [report.fotoBase64],
    reporter: String(report.autorNombre || 'Ciudadanía'),
    citizenUid: report.usuarioUid, status: 'nuevo', creadoEn: serverTimestamp(),
  });
}
export async function assignWork(report, note, sectorName) {
  requireUser();
  await updateDoc(doc(db, 'systemReports', report.id), {
    status: 'asignado', assignment: {
      crew: `Cuadrilla ${sectorName}`, instructions: String(note || '').slice(0, 280),
      at: new Date().toISOString(),
    },
  });
  await setDoc(doc(db, 'sectorStatus', report.sectorId), { sectorId: report.sectorId, state: 'reparacion', actualizadoEn: serverTimestamp() });
}
export async function markWorkDone(report, note) {
  requireUser();
  await updateDoc(doc(db, 'systemReports', report.id), {
    status: 'terminado', workDone: { note: String(note || 'Trabajo terminado.').slice(0, 280), at: new Date().toISOString() },
  });
}
export async function resolveAndNotify(report, message, otherOpenReports = [], operatorName = 'Operador') {
  const user = requireUser();
  const text = String(message || '').trim();
  if (text.length < 10) throw Error('Escribe un aviso de al menos 10 caracteres.');
  const remaining = otherOpenReports.some((r) => r.id !== report.id && r.sectorId === report.sectorId && ['asignado', 'terminado'].includes(r.status));
  const batch = writeBatch(db);
  batch.update(doc(db, 'systemReports', report.id), { status: 'resuelto', notice: { message: text, at: new Date().toISOString() } });
  batch.set(doc(collection(db, 'notices')), {
    title: 'Aviso del servicio de agua', message: text, kind: 'operaciones',
    sectorId: report.sectorId, audience: 'sector', level: 'info',
    reporter: `Departamento de Operaciones · ${operatorName}`,
    publishedBy: user.uid, reportId: report.id, creadoEn: serverTimestamp(),
  });
  batch.set(doc(db, 'sectorStatus', report.sectorId), {
    sectorId: report.sectorId, state: remaining ? 'reparacion' : 'normal', actualizadoEn: serverTimestamp(),
  });
  await batch.commit();
}
export async function publishSectorNotice(data, name) {
  const user = requireUser();
  const message = String(data.message || '').trim();
  const title = String(data.title || '').trim();
  if (!data.sectorId || title.length < 5 || message.length < 10) throw Error('Completa sector, título y mensaje.');
  await addDoc(collection(db, 'notices'), {
    kind: data.kind || 'tandeo', audience: data.audience || 'sector',
    sectorId: data.sectorId, title, message, level: data.level || 'info',
    reporter: `Departamento de Operaciones · ${name}`, publishedBy: user.uid,
    position: data.position || null, creadoEn: serverTimestamp(),
  });
}

export async function publishRiskFromReport(report, operatorName = 'Operador') {
  const user = requireUser();
  if (report.source !== 'proteccion-civil' || report.status !== 'nuevo') throw Error('Solo se puede publicar una alerta de Protección Civil pendiente.');
  const batch = writeBatch(db);
  batch.update(doc(db, 'systemReports', report.id), { status: 'publicado' });
  batch.set(doc(collection(db, 'notices')), {
    kind: 'alerta-proteccion-civil', audience: 'todos', sectorId: report.sectorId,
    title: `Alerta de Protección Civil · ${report.colonia}`,
    message: report.description, level: report.level || 'alto',
    reporter: `Protección Civil · Publicado por Departamento de Operaciones · ${operatorName}`,
    reportId: report.id, publishedBy: user.uid, creadoEn: serverTimestamp(),
  });
  await batch.commit();
}
