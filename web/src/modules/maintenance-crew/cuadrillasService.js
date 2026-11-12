// ARCA · Cuadrillas · Fuente real de datos en Firestore.
import { auth } from '../auth/firebase';
import {
  collection, doc, getDoc, getFirestore, onSnapshot,
  query, runTransaction, serverTimestamp, where, writeBatch,
} from 'firebase/firestore';

const db = auth?.app ? getFirestore(auth.app) : null;
function session() {
  if (!db || !auth?.currentUser) throw Error('Inicia sesión para continuar.');
  return auth.currentUser;
}
const mapDocs = (snap) => snap.docs.map((d) => ({ id: d.id, ...d.data() }));

export function watchCrewSectors(callback, onError) {
  if (!db) { onError?.(Error('Firebase no configurado')); return () => {}; }
  return onSnapshot(collection(db, 'sectors'), (s) => callback(mapDocs(s)), onError);
}
export function watchCrewCitizenReports(callback, onError) {
  if (!db) { onError?.(Error('Firebase no configurado')); return () => {}; }
  return onSnapshot(collection(db, 'reportes'), (snapshot) => callback(mapDocs(snapshot)), onError);
}
export function watchAssignedJobs(callback, onError) {
  if (!db) { onError?.(Error('Firebase no configurado')); return () => {}; }
  const assigned = query(collection(db, 'systemReports'),
    where('source', 'in', ['ciudadano', 'operaciones']),
    where('status', 'in', ['asignado', 'terminado', 'resuelto']));
  return onSnapshot(assigned, (s) => callback(
    mapDocs(s).filter((r) => r.source !== 'proteccion-civil'
      && ['asignado', 'terminado', 'resuelto'].includes(r.status)
      && r.assignment?.crew && r.sectorId)
  ), onError);
}
export function watchSectorCrews(callback, onError) {
  if (!db) { onError?.(Error('Firebase no configurado')); return () => {}; }
  return onSnapshot(collection(db, 'sectorCrews'), (snap) => callback(
    Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]))
  ), onError);
}

function validMember(member) {
  const name = String(member.name || '').trim();
  if (name.length < 2 || name.length > 60 || !['jefe', 'fontanero', 'valvulas', 'ayudante'].includes(member.role))
    throw Error('Nombre (2-60) y puesto válidos obligatorios.');
  return { id: member.id || doc(collection(db, 'sectorCrews')).id, name, role: member.role };
}
export async function saveCrewMember(sectorId, member) {
  session();
  if (!sectorId) throw Error('Selecciona un sector.');
  const record = validMember(member);
  const ref = doc(db, 'sectorCrews', sectorId);
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref);
    const members = snap.exists() ? [...(snap.data().members || [])] : [];
    const idx = members.findIndex((m) => m.id === record.id);
    if (idx === -1) members.push(record); else members[idx] = record;
    if (members.length > 30) throw Error('Máximo 30 integrantes por sector.');
    t.set(ref, { sectorId, members, actualizadoEn: serverTimestamp() });
  });
}
export async function deleteCrewMember(sectorId, memberId) {
  session();
  const ref = doc(db, 'sectorCrews', sectorId);
  await runTransaction(db, async (t) => {
    const snap = await t.get(ref);
    if (!snap.exists()) throw Error('No existe la cuadrilla.');
    const members = (snap.data().members || []).filter((m) => m.id !== memberId);
    t.update(ref, { members, actualizadoEn: serverTimestamp() });
  });
}
export async function startCrewJob(id, leader) {
  session();
  const ref = doc(db, 'systemReports', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw Error('El trabajo ya no existe.');
  const report = snapshot.data();
  if (report.status !== 'asignado' || report.assignment?.progress)
    throw Error('El trabajo ya fue iniciado o no está asignado.');
  const crewSnap = await getDoc(doc(db, 'sectorCrews', report.sectorId));
  if (!(crewSnap.data()?.members || []).some((m) => m.name === leader))
    throw Error('Selecciona un integrante de la cuadrilla de este sector.');
  const progress = { state: 'en-proceso', leader, at: new Date().toISOString() };
  const batch = writeBatch(db);
  batch.update(ref, { 'assignment.progress': progress });
  if (report.source === 'ciudadano' && report.citizenReportId) {
    batch.update(doc(db, 'reportes', report.citizenReportId), { estado: 'en-reparacion' });
  }
  const pubRef = doc(db, 'workUpdates', id);
  if ((await getDoc(pubRef)).exists()) {
    batch.update(pubRef, { status: 'en-proceso', actualizadoEn: serverTimestamp() });
  } else {
    batch.set(pubRef, {
      reportId: id, sectorId: report.sectorId,
      sectorName: String(report.assignment.crew || '').slice(0, 120),
      title: String(report.type || 'Mantenimiento').slice(0, 120),
      position: report.position, status: 'en-proceso', actualizadoEn: serverTimestamp(),
    });
  }
  await batch.commit();
}

export async function assignCitizenJob(reportId, sector, member) {
  session();
  const id = `ciudadano_${reportId}`;
  const citizenRef = doc(db, 'reportes', reportId);
  const workRef = doc(db, 'systemReports', id);
  await runTransaction(db, async (transaction) => {
    const citizen = await transaction.get(citizenRef);
    const existing = await transaction.get(workRef);
    const report = citizen.data();
    if (!report || report.estado !== 'pendiente' || (existing.exists() && existing.data().status !== 'nuevo')) {
      throw Error('Este reporte ya está siendo atendido o dejó de estar disponible.');
    }
    if (existing.exists() && existing.data().sectorId !== sector.id) {
      throw Error('Operaciones ya incorporó este reporte. Selecciona el sector que le asignó.');
    }
    const at = new Date().toISOString();
    const assignment = {
      crew: `Cuadrilla ${sector.name}`, instructions: '', at,
      progress: { state: 'en-proceso', leader: member.name, member, at },
    };
    if (existing.exists()) {
      transaction.update(workRef, { status: 'asignado', assignment });
    } else {
      transaction.set(workRef, {
        source: 'ciudadano', citizenReportId: reportId, citizenUid: report.usuarioUid,
        sectorId: sector.id, type: report.tipo, colonia: report.titulo.slice(0, 100),
        description: report.descripcion, position: report.ubicacion,
        photos: report.fotoBase64 ? [report.fotoBase64] : [],
        reporter: report.autorNombre || 'Ciudadanía', status: 'asignado', assignment, creadoEn: serverTimestamp(),
      });
    }
    const work = existing.data();
    transaction.set(doc(db, 'workUpdates', id), {
      reportId: id, sectorId: sector.id, sectorName: sector.name,
      title: work?.type || report.tipo, position: work?.position || report.ubicacion,
      status: 'en-proceso', actualizadoEn: serverTimestamp(),
    });
    transaction.update(citizenRef, { estado: 'en-reparacion' });
  });
}
export async function finishCrewJob(id, { note, photos }) {
  session();
  const ref = doc(db, 'systemReports', id);
  const snapshot = await getDoc(ref);
  if (!snapshot.exists()) throw Error('El trabajo ya no existe.');
  const report = snapshot.data();
  if (report.status !== 'asignado' || report.assignment?.progress?.state !== 'en-proceso')
    throw Error('Primero debes iniciar el trabajo.');
  const text = String(note || '').trim();
  if (text.length < 10 || text.length > 280) throw Error('Describe el trabajo (10 a 280 caracteres).');
  if (!Array.isArray(photos) || photos.length < 1 || photos.length > 3 ||
      photos.some((photo) => typeof photo !== 'string' || photo.length > 160000 ||
        !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(photo)))
    throw Error('Adjunta de 1 a 3 fotografías JPEG comprimidas (máximo 160 KB cada una).');
  const workDone = { note: text, photos, by: report.assignment.progress.leader, at: new Date().toISOString() };
  const batch = writeBatch(db);
  batch.update(ref, { status: 'terminado', workDone });
  if (report.source === 'ciudadano' && report.citizenReportId) {
    batch.update(doc(db, 'reportes', report.citizenReportId), {
      estado: 'reparado', fotoReparacion: photos[0],
    });
  }
  const pubRef = doc(db, 'workUpdates', id);
  if ((await getDoc(pubRef)).exists()) {
    batch.update(pubRef, { status: 'terminado', actualizadoEn: serverTimestamp() });
  } else {
    batch.set(pubRef, {
      reportId: id, sectorId: report.sectorId,
      sectorName: String(report.assignment.crew || '').slice(0, 120),
      title: String(report.type || 'Mantenimiento').slice(0, 120),
      position: report.position, status: 'terminado', actualizadoEn: serverTimestamp(),
    });
  }
  await batch.commit();
}
