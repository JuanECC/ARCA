
 // ARCA · Protección Civil · Firestore compartido con Operaciones.
 // No altera Authentication ni usa Storage/localStorage para datos institucionales.
 import { auth } from '../auth/firebase';
 import {
   addDoc, collection, deleteDoc, doc, getDoc, getDocs, getFirestore, onSnapshot, query, where,
   serverTimestamp, updateDoc, writeBatch,
 } from 'firebase/firestore';

 const db = auth?.app ? getFirestore(auth.app) : null;
 const requireSession = () => {
   if (!db || !auth?.currentUser) throw Error('Inicia sesión para continuar.');
   return auth.currentUser;
 };

 const watch = (name, convert, callback, onError) => {
   if (!db) { onError?.(Error('Firebase no está configurado.')); return () => {}; }
   return onSnapshot(collection(db, name),
     (snapshot) => callback(snapshot.docs.map((entry) => convert({ id: entry.id, ...entry.data() }))),
     onError);
 };

 const asPosition = (point) => Array.isArray(point)
   ? { lat: Number(point[0]), lng: Number(point[1]) }
   : { lat: Number(point?.lat), lng: Number(point?.lng) };
 const pointArray = (point) => Array.isArray(point)
   ? point
   : [Number(point?.lat), Number(point?.lng)];
 const dateString = (date) => date?.toDate?.()?.toISOString?.()
   || (typeof date === 'string' ? date : null)
   || new Date().toISOString();
 const asAlert = (a) => ({
   ...a,
   position: pointArray(a.position),
   createdAt: dateString(a.creadoEn ?? a.createdAt),
   alert: a.alert ? { ...a.alert, at: dateString(a.alert.at) } : undefined,
   closure: a.closure ? { ...a.closure, at: dateString(a.closure.at) } : undefined,
 });

 export const watchPcSectors = (callback, error) => watch('sectors',
   (s) => ({ ...s, center: s.center ? pointArray(s.center) : [19.176, -96.138] }), callback, error);
 export const watchPcAlerts = (callback, error) => watch('systemReports',
   (a) => a, (all) => callback(all.filter((a) => a.source === 'proteccion-civil').map(asAlert)), error);
 export const watchPcUnits = (callback, error) => watch('pcUnits', (u) => u, callback, error);

 const photoValid = (p) => typeof p === 'string'
   && p.length <= 170000
   && /^data:image\/webp;base64,[A-Za-z0-9+/=]+$/.test(p);

 export async function savePcAlert(input) {
   const user = requireSession();
   if (!input.sectorId || !input.position || !input.colonia?.trim())
     throw Error('Selecciona sector, ubicación y punto en el mapa.');
   if (!Array.isArray(input.photos) || input.photos.length !== 1 || !photoValid(input.photos[0]))
     throw Error('Agrega una fotografía comprimida válida (máximo 160 KB en Base64).');
   const position = asPosition(input.position);
   if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng))
     throw Error('Las coordenadas del reporte no son válidas.');
   const payload = {
     type: input.type,
     level: input.level,
     sectorId: input.sectorId,
     colonia: input.colonia.trim().slice(0, 100),
     description: input.description.trim().slice(0, 1500),
     position,
     reporter: String(input.reporter || 'Protección Civil').slice(0, 200),
     photos: [input.photos[0]],
   };
   if (input.id) {
     if (input.status !== 'nuevo' || input.closure) throw Error('Solo pueden editarse alertas sin publicar.');
     await updateDoc(doc(db, 'systemReports', input.id), payload);
     return input.id;
   }
   if (payload.description.length < 10) throw Error('Describe el riesgo en al menos 10 caracteres.');
   const ref = await addDoc(collection(db, 'systemReports'), {
     ...payload, source: 'proteccion-civil', status: 'nuevo',
     createdBy: user.uid, creadoEn: serverTimestamp(),
   });
   return ref.id;
 }

 // Solo se eliminan borradores. El historial de un riesgo publicado se conserva.
 // Los borradores antiguos pueden carecer del campo createdBy; solo la cuenta
 // institucional de Protección Civil podrá eliminarlos (ver regla específica).
 export async function removePcAlert(id) {
   const user = requireSession();
   const ref = doc(db, 'systemReports', id);
   const snap = await getDoc(ref);
   if (!snap.exists()) throw Error('Esta alerta ya no existe. Actualiza la lista.');
   const data = snap.data();
   if (data.source !== 'proteccion-civil' || data.status !== 'nuevo' || data.alert || data.closure) {
     throw Error('Solo es posible eliminar borradores sin publicar. Los riesgos publicados deben controlarse y retirar su aviso, conservando el historial.');
   }
   if (data.createdBy && data.createdBy !== user.uid) {
     throw Error('No tienes permiso para eliminar un borrador creado por otra cuenta.');
   }
   try {
     await deleteDoc(ref);
   } catch (error) {
     if (error.code === 'permission-denied') {
       throw Error('Firestore rechazó la eliminación del borrador. Publica las reglas corregidas y verifica que el documento tenga source="proteccion-civil" y status="nuevo".');
     }
     throw error;
   }
 }

 export async function publishPcAlert(alert, { title, message }) {
   const user = requireSession();
   if (alert.status !== 'nuevo' || alert.closure) throw Error('La alerta ya fue publicada o controlada.');
   const heading = title?.trim();
   const body = message?.trim();
   if (!heading || heading.length < 5 || heading.length > 120 || !body || body.length < 10 || body.length > 600)
     throw Error('Revisa título y contenido del aviso.');
   const position = asPosition(alert.position);
   if (!Number.isFinite(position.lat) || !Number.isFinite(position.lng)
       || Math.abs(position.lat) > 90 || Math.abs(position.lng) > 180) {
     throw Error('Selecciona una ubicación válida antes de publicar el aviso.');
   }
   const batch = writeBatch(db);
   const now = new Date().toISOString();
   batch.update(doc(db, 'systemReports', alert.id), {
     status: 'publicado', alert: { title: heading, message: body, by: 'Departamento de Protección Civil', at: now },
   });
   batch.set(doc(collection(db, 'notices')), {
     kind: 'alerta-proteccion-civil', audience: 'todos', sectorId: alert.sectorId,
     title: heading, message: body, level: alert.level,
     reporter: 'Departamento de Protección Civil',
     publishedBy: user.uid, reportId: alert.id, position, creadoEn: serverTimestamp(),
     ...(alert.photos?.[0] ? { fotoBase64: alert.photos[0] } : {}),
   });
   await batch.commit();
 }

 // Devuelve solo publicaciones propias de PC que pertenecen a este riesgo.
 // Soporta avisos históricos sin reportId únicamente con coincidencia exacta
 // de autor, sector, título y mensaje. Nunca adivina por proximidad geográfica.
 async function findPcPublication(report) {
   const user = requireSession();
   const exact = await getDocs(query(
     collection(db, 'notices'), where('reportId', '==', report.id),
   ));
   const own = exact.docs.filter((entry) =>
     entry.data().kind === 'alerta-proteccion-civil'
     && entry.data().publishedBy === user.uid,
   );
   if (own.length > 1) throw Error('Hay varias publicaciones asociadas a este reporte. Revisa notices antes de retirarlas.');
   if (own.length) return own;

   if (!report.alert?.title || !report.alert?.message || !report.sectorId) return [];
   const legacy = await getDocs(query(
     collection(db, 'notices'), where('kind', '==', 'alerta-proteccion-civil'),
   ));
   const matches = legacy.docs.filter((entry) => {
     const notice = entry.data();
     return !notice.reportId
       && notice.publishedBy === user.uid
       && notice.sectorId === report.sectorId
       && notice.title === report.alert.title
       && notice.message === report.alert.message;
   });
   if (matches.length > 1) {
     throw Error('Hay varios avisos antiguos idénticos. No se modificó ninguno para evitar enlazar un riesgo equivocado.');
   }
   if (!matches.length) {
     console.warn('[ARCA] Aviso de Protección Civil no localizado', {
       reportId: report.id,
       sectorId: report.sectorId,
       titulo: report.alert.title,
       avisosRevisados: legacy.size,
     });
   }
   return matches;
 }

 function verifyPcReport(report, user) {
   if (report.source !== 'proteccion-civil') {
     throw Error('El reporte no pertenece a Protección Civil.');
   }
   if (report.createdBy && report.createdBy !== user.uid) {
     throw Error('El reporte corresponde a otra cuenta.');
   }
 }

 async function loadPcReport(id) {
   const user = requireSession();
   const snap = await getDoc(doc(db, 'systemReports', id));
   if (!snap.exists()) throw Error('El riesgo no existe o ya fue retirado.');
   const report = { id, ...snap.data() };
   verifyPcReport(report, user);
   return report;
 }

 // Cierre atómico: mantiene systemReports.closure y notices.estado sincronizados.
 // Así el punto ciudadano cambia de rojo a VERDE sin consultar datos privados.
 export async function controlPcAlert(id, note) {
   requireSession();
   const text = String(note || '').trim();
   if (text.length < 10 || text.length > 280) {
     throw Error('Describe cómo se controló el riesgo usando entre 10 y 280 caracteres.');
   }
   const report = await loadPcReport(id);
   if (report.closure) {
     // Compatibilidad: un cierre anterior puede no haber actualizado notices.
     return syncPcControlledNotice(id);
   }

   const linked = report.status === 'publicado' ? await findPcPublication(report) : [];
   if (report.status === 'publicado' && linked.length === 0) {
     throw Error('No encontré el aviso público relacionado. Revisa reportId y la coincidencia de título, mensaje y sector antes de marcar como controlado.');
   }
   const batch = writeBatch(db);
   batch.update(doc(db, 'systemReports', id), {
     closure: { note: text, at: new Date().toISOString() },
   });
   linked.forEach((entry) => {
     const data = entry.data();
     const patch = {};
     if (data.estado !== 'controlado') patch.estado = 'controlado';
     if (!data.reportId) patch.reportId = id;
     if (Object.keys(patch).length) batch.update(entry.ref, patch);
   });
   await batch.commit();
   return { controlled: true, notices: linked.length };
 }

 // Para riesgos que YA estaban controlados antes de esta corrección.
 // Puede llamarse desde el botón «Actualizar aviso»; no reescribe el cierre.
 export async function syncPcControlledNotice(id) {
   const report = await loadPcReport(id);
   if (!report.closure) throw Error('Primero marca el riesgo como controlado.');
   if (report.status !== 'publicado' || report.publicationRetired) {
     return { synced: 0, noPublication: true };
   }
   const linked = await findPcPublication(report);
   if (!linked.length) {
     throw Error('No se encontró un aviso relacionado. Si es antiguo, compara reportId, título, mensaje, sector y publishedBy en Firebase Console.');
   }
   const batch = writeBatch(db);
   let modified = 0;
   linked.forEach((entry) => {
     const data = entry.data();
     const patch = {};
     if (data.estado !== 'controlado') patch.estado = 'controlado';
     if (!data.reportId) patch.reportId = id;
     if (Object.keys(patch).length) {
       batch.update(entry.ref, patch);
       modified++;
     }
   });
   if (modified) await batch.commit();
   return { synced: modified, notices: linked.length };
 }

 // Retirar SOLO el aviso ciudadano después del cierre. El reporte queda
 // en systemReports como historial, con publicationRetired: true.
 export async function withdrawPcPublication(reportOrId) {
   const id = typeof reportOrId === 'string' ? reportOrId : reportOrId?.id;
   if (!id) throw Error('Falta el identificador del riesgo.');
   const report = await loadPcReport(id);
   if (report.publicationRetired) return { alreadyRetired: true };
   if (report.status !== 'publicado' || !report.closure) {
     throw Error('Solo se pueden retirar avisos de riesgos publicados y controlados.');
   }

   // Identificar el aviso antes de escribir: evita operaciones parciales si no existe.
   const linked = await findPcPublication(report);
   if (!linked.length) {
     throw Error('No hay un aviso relacionado en notices. Revisa si es una publicación antigua sin reportId o si ya fue eliminada. No se modificó el historial.');
   }

   // Las reglas requieren que el aviso esté controlado y vinculado al reporte
   // antes de autorizar el borrado. Esta escritura se realiza por separado.
   await syncPcControlledNotice(id);

   const batch = writeBatch(db);
   linked.forEach((entry) => batch.delete(entry.ref));
   batch.update(doc(db, 'systemReports', id), { publicationRetired: true });
   await batch.commit();
   return { withdrawn: linked.length };
 }

 export async function savePcUnit(unit) {
   requireSession();
   const value = {
     name: String(unit.name || '').trim().slice(0, 40),
     leader: String(unit.leader || '').trim().slice(0, 60),
     shift: unit.shift,
     status: unit.status,
     sectorId: unit.sectorId,
   };
   if (!value.name || !value.leader || !value.sectorId) throw Error('Completa los datos de la unidad.');
   if (unit.id) await updateDoc(doc(db, 'pcUnits', unit.id), value);
   else await addDoc(collection(db, 'pcUnits'), value);
 }
 export async function removePcUnit(id) {
   requireSession();
   await deleteDoc(doc(db, 'pcUnits', id));
 }

 // Vista unificada de solo lectura. No mezcla los flujos de autorización de cada módulo.
 const toDate = (value) => value?.toDate?.() || (value ? new Date(value) : null);
 const point = (value) => {
   const lat = Number(Array.isArray(value) ? value[0] : value?.lat);
   const lng = Number(Array.isArray(value) ? value[1] : value?.lng);
   return Number.isFinite(lat) && Number.isFinite(lng) ? [lat, lng] : null;
 };
 const asActivity = (type, a) => {
   const origin = type === 'reportes' ? 'ciudadania'
     : type === 'notices' ? 'aviso'
     : a.source === 'proteccion-civil' ? 'proteccion-civil' : 'operaciones';
   const rawDate = a.creadoEn || a.createdAt;
   return {
     key: `${type}:${a.id}`, id: a.id, origin,
     sectorId: a.sectorId || '',
     title: a.titulo || a.title || a.type || a.tipo || 'Incidencia sin título',
     description: a.descripcion || a.description || a.message || '',
     status: a.estado || a.status || (type === 'notices' ? 'publicado' : 'nuevo'),
     reporter: a.autorNombre || a.reporter || (type === 'notices' ? 'Departamento de Operaciones / Protección Civil' : ''),
     position: point(a.position || a.ubicacion),
     photo: a.fotoBase64 || a.photos?.[0] || null,
     date: toDate(rawDate),
   };
 };

 export function watchArcaActivity(callback, onError) {
   if (!db) { onError?.(Error('Firebase no está configurado.')); return () => {}; }
   const latest = { reportes: [], systemReports: [], notices: [] };
   const received = new Set();
   const unsubscribers = Object.keys(latest).map((name) => onSnapshot(
     collection(db, name),
     (snapshot) => {
       latest[name] = snapshot.docs.map((entry) => asActivity(name, { id: entry.id, ...entry.data() }));
       received.add(name);
       const records = Object.values(latest).flat().sort((a, b) =>
         (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
       callback(records, received.size === Object.keys(latest).length);
     },
     (error) => { received.add(name); onError?.(error, name); }
   ));
   return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
 }
