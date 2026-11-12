
import { auth } from '../auth/firebase';
import {
  addDoc, collection, deleteDoc, doc, getDoc, getFirestore, onSnapshot,
  query, serverTimestamp, setDoc, updateDoc, writeBatch,
} from 'firebase/firestore';

const db = auth?.app ? getFirestore(auth.app) : null;

const requireUser = () => {
  if (!db || !auth?.currentUser) {
    throw Error('Inicia sesión para continuar.');
  }
  return auth.currentUser;
};

const collections = {
  sectors: 'sectors',
  schedule: 'schedule',
  reports: 'systemReports',
  notices: 'notices',
  status: 'sectorStatus',
};

const asArray = (snap) =>
  snap.docs.map((item) => ({ id: item.id, ...item.data() }));

const watch = (name, callback, onError) => {
  if (!db) {
    onError?.(Error('Firebase no configurado.'));
    return () => {};
  }

  return onSnapshot(
    collection(db, collections[name]),
    (snapshot) => callback(asArray(snapshot)),
    onError
  );
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

  if (
    name.length < 3 || name.length > 100 ||
    colonias.length < 3 || colonias.length > 500
  ) {
    throw Error('Indica nombre (3–100 caracteres) y colonias (3–500).');
  }

  if (input.id) {
    await updateDoc(doc(db, 'sectors', input.id), {
      name,
      colonias,
      actualizadoEn: serverTimestamp(),
    });
  } else {
    await addDoc(collection(db, 'sectors'), {
      name,
      colonias,
      active: true,
      creadoEn: serverTimestamp(),
      actualizadoEn: serverTimestamp(),
    });
  }
}

export async function setSectorActive(id, active) {
  requireUser();
  await updateDoc(doc(db, 'sectors', id), {
    active,
    actualizadoEn: serverTimestamp(),
  });
}

export async function saveDay(sectorId, date, day) {
  requireUser();

  if (!sectorId || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw Error('Sector o fecha no válido.');
  }

  const { status, from, to, note } = day;

  if (!['continuo', 'parcial', 'corte'].includes(status)) {
    throw Error('Estado inválido.');
  }

  if (
    status === 'parcial' &&
    (!/^\d{2}:\d{2}$/.test(from) ||
      !/^\d{2}:\d{2}$/.test(to) ||
      from >= to)
  ) {
    throw Error('El horario parcial no es válido.');
  }

  await setDoc(doc(db, 'schedule', `${sectorId}_${date}`), {
    sectorId,
    fecha: date,
    status,
    from: status === 'corte' ? '' : (status === 'continuo' ? '00:00' : from),
    to: status === 'corte' ? '' : (status === 'continuo' ? '23:59' : to),
    note: String(note || '').slice(0, 400),
    actualizadoEn: serverTimestamp(),
  });
}

export async function removeDay(sectorId, date) {
  requireUser();
  await deleteDoc(doc(db, 'schedule', `${sectorId}_${date}`));
}

export async function saveOperationalReport(input) {
  const user = requireUser();

  if (!input.sectorId || !input.position || !input.photo) {
    throw Error('Selecciona sector, punto del mapa y fotografía.');
  }

  if (
    !/^data:image\/(webp|jpeg);base64,/.test(input.photo) ||
    input.photo.length > 170000
  ) {
    throw Error('La fotografía debe estar comprimida (máximo 170 mil caracteres).');
  }

  const reporterName = String(input.reporterName || '').trim();
  if (!reporterName) {
    throw Error('No se pudo identificar al operador.');
  }

  await addDoc(collection(db, 'systemReports'), {
    source: 'operaciones',
    sectorId: input.sectorId,
    type: input.type,
    colonia: String(input.colonia || '').slice(0, 100),
    description: String(input.description || '').slice(0, 1500),
    position: {
      lat: Number(input.position.lat),
      lng: Number(input.position.lng),
    },
    photos: [input.photo],
    status: 'nuevo',
    reporter: `Departamento de Operaciones · ${reporterName}`,
    createdBy: user.uid,
    creadoEn: serverTimestamp(),
  });
}

export async function incorporateCitizenReport(report, sectorId) {
  requireUser();

  if (!report?.id || !sectorId || !report.fotoBase64 || !report.ubicacion) {
    throw Error('Se requiere evidencia y ubicación para asignar el reporte.');
  }

  const ref = doc(db, 'systemReports', `ciudadano_${report.id}`);

  if ((await getDoc(ref)).exists()) {
    throw Error('Este reporte ya fue incorporado a Operaciones.');
  }

  await setDoc(ref, {
    source: 'ciudadano',
    citizenReportId: report.id,
    sectorId,
    type: report.tipo === 'fuga' ? 'fuga' : 'drenaje',
    colonia: String(report.titulo || '').slice(0, 100),
    description: String(report.descripcion || ''),
    position: report.ubicacion,
    photos: [report.fotoBase64],
    reporter: String(report.autorNombre || 'Ciudadanía'),
    citizenUid: report.usuarioUid,
    status: 'nuevo',
    creadoEn: serverTimestamp(),
  });
}

// OPERACIONES: ASIGNAR REPORTE A CUADRILLAS
export async function assignWork(report, note, sectorName) {
  requireUser();

  if (report.source === 'proteccion-civil' || report.status !== 'nuevo') {
    throw Error('Solo pueden asignarse reportes de agua nuevos.');
  }

  const instructions = String(note || '').trim().slice(0, 280);
  const batch = writeBatch(db);

  batch.update(doc(db, 'systemReports', report.id), {
    status: 'asignado',
    assignment: {
      crew: `Cuadrilla ${sectorName}`,
      instructions,
      at: new Date().toISOString(),
    },
  });

  batch.set(doc(db, 'workUpdates', report.id), {
    reportId: report.id,
    sectorId: report.sectorId,
    sectorName: String(sectorName || '').slice(0, 120),
    title: String(report.type || 'Mantenimiento de agua').slice(0, 120),
    position: report.position,
    status: 'asignado',
    actualizadoEn: serverTimestamp(),
  });
  if (report.source === 'ciudadano' && report.citizenReportId) {
    batch.update(doc(db, 'reportes', report.citizenReportId), { estado: 'en-revision' });
  }

  batch.set(doc(db, 'sectorStatus', report.sectorId), {
    sectorId: report.sectorId,
    state: 'reparacion',
    actualizadoEn: serverTimestamp(),
  });

  await batch.commit();
}

// Se conserva para evitar romper imports antiguos.
export async function markWorkDone() {
  throw Error(
    'La cuadrilla debe terminar el trabajo desde su módulo y adjuntar evidencia.'
  );
}

// OPERACIONES: VERIFICAR, RESOLVER Y NOTIFICAR
export async function resolveAndNotify(
  report,
  message,
  otherOpenReports = [],
  operatorName = 'Operador'
) {
  const user = requireUser();
  const text = String(message || '').trim();

  if (report.status !== 'terminado') {
    throw Error('La cuadrilla debe terminar primero el trabajo.');
  }

  if (text.length < 10) {
    throw Error('Escribe un aviso de al menos 10 caracteres.');
  }

  const remaining = otherOpenReports.some(
    (r) =>
      r.id !== report.id &&
      r.sectorId === report.sectorId &&
      ['asignado', 'terminado'].includes(r.status)
  );

  const batch = writeBatch(db);

  batch.update(doc(db, 'systemReports', report.id), {
    status: 'resuelto',
    notice: {
      message: text,
      at: new Date().toISOString(),
    },
  });

  batch.set(doc(collection(db, 'notices')), {
    title: 'Aviso del servicio de agua',
    message: text,
    kind: 'operaciones',
    sectorId: report.sectorId,
    audience: 'sector',
    level: 'info',
    reporter: `Departamento de Operaciones · ${operatorName}`,
    publishedBy: user.uid,
    reportId: report.id,
    creadoEn: serverTimestamp(),
  });

  batch.set(doc(db, 'sectorStatus', report.sectorId), {
    sectorId: report.sectorId,
    state: remaining ? 'reparacion' : 'normal',
    actualizadoEn: serverTimestamp(),
  });

  const publicRef = doc(db, 'workUpdates', report.id);
  if (report.source === 'ciudadano' && report.citizenReportId) {
    batch.update(doc(db, 'reportes', report.citizenReportId), { estado: 'resuelto' });
  }

  if ((await getDoc(publicRef)).exists()) {
    batch.update(publicRef, {
      status: 'resuelto',
      actualizadoEn: serverTimestamp(),
    });
  }

  await batch.commit();
}

export async function publishSectorNotice(data, name) {
  const user = requireUser();
  const message = String(data.message || '').trim();
  const title = String(data.title || '').trim();

  if (!data.sectorId || title.length < 5 || message.length < 10) {
    throw Error('Completa sector, título y mensaje.');
  }

  await addDoc(collection(db, 'notices'), {
    kind: data.kind || 'tandeo',
    audience: data.audience || 'sector',
    sectorId: data.sectorId,
    title,
    message,
    level: data.level || 'info',
    reporter: `Departamento de Operaciones · ${name}`,
    publishedBy: user.uid,
    position: data.position || null,
    creadoEn: serverTimestamp(),
  });
}

// Se conserva para evitar romper imports antiguos.
export async function publishRiskFromReport() {
  throw Error(
    'Las alertas de Protección Civil se publican exclusivamente desde su panel.'
  );
}
