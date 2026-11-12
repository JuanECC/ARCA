import { auth } from '../auth/firebase';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp, doc, getDoc, getDocFromCache } from 'firebase/firestore';
import { offlineEnabled } from '../offline/preferences';
import { listPending, savePending } from '../offline/outboxStore';
import { syncPendingReports } from '../offline/reportSync';
import { isCitizenProfileComplete } from './profileService';
import { compressPhoto } from './photoUtils';

const db = auth?.app ? getFirestore(auth.app) : null;
export const REPORT_TYPES = [
  { value: 'inundacion', label: 'Inundación' },
  { value: 'encharcamiento', label: 'Encharcamiento' },
  { value: 'fuga', label: 'Fuga de agua' },
  { value: 'drenaje', label: 'Drenaje obstruido' },
  { value: 'otro', label: 'Otro problema hídrico' },
];
export function subscribeReports(onData, onError) {
  if (!db) { onError?.(new Error('Firebase no está configurado.')); return () => {}; }
  return onSnapshot(query(collection(db, 'reportes'), orderBy('creadoEn', 'desc')), snapshot => {
    onData(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
  }, onError);
}
export function getCurrentLocation() {
  if (!navigator.geolocation) return Promise.reject(new Error('Este dispositivo no permite obtener ubicación.'));
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(
      p => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracy: p.coords.accuracy }),
      e => reject(new Error(e.code === 1 ? 'Debes autorizar el acceso a tu ubicación.' : 'No se pudo determinar tu ubicación. Activa el GPS e inténtalo de nuevo.')),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}
// Reduce la foto en el navegador antes de guardarla como texto Base64.
// Firestore limita cada documento a 1 MiB: objetivo <= 120 KiB binarios.

export async function createCitizenReport({ titulo, descripcion, tipo, ubicacion, foto }) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para generar un reporte.');
  if (!db) throw new Error('Firebase no está configurado.');
  if (!navigator.onLine && !offlineEnabled()) throw new Error('Prepara este dispositivo para uso sin conexión antes de guardar reportes durante un corte.');
  const title = titulo.trim(), details = descripcion.trim();
  if (title.length < 5 || title.length > 100 || details.length < 10 || details.length > 1500) throw new Error('El título debe tener de 5 a 100 caracteres y la descripción de 10 a 1500.');
  if (!REPORT_TYPES.some(t => t.value === tipo)) throw new Error('Selecciona un tipo de reporte válido.');
  if (!ubicacion || !Number.isFinite(ubicacion.latitude) || !Number.isFinite(ubicacion.longitude) || !Number.isFinite(ubicacion.accuracy) || ubicacion.accuracy < 0 || Math.abs(ubicacion.latitude) > 90 || Math.abs(ubicacion.longitude) > 180) throw new Error('Obtén una ubicación válida antes de enviar.');
  // Segunda comprobación al enviar: no confiar únicamente en el bloqueo visual.
  const read = navigator.onLine ? getDoc : getDocFromCache;
  const [profileSnapshot, configSnapshot] = await Promise.all([
    read(doc(db, 'usuarios', user.uid)),
    read(doc(db, 'usuarios', user.uid, 'configuracion', 'perfil')),
  ]);
  if (!profileSnapshot.exists() || profileSnapshot.data().role !== 'citizen') {
    throw new Error('Solo una cuenta ciudadana válida puede enviar reportes.');
  }
  if (!configSnapshot.exists() || !isCitizenProfileComplete(configSnapshot.data())) {
    throw new Error('Completa tu perfil antes de generar reportes.');
  }
  const autorNombre = String(profileSnapshot.data().nombre || '').trim();
  if (autorNombre.length < 2) throw new Error('No se encontró el nombre de tu cuenta.');
  const fotoBase64 = await compressPhoto(foto);
  const payload = {
    usuarioUid: user.uid, autorNombre, titulo: title, descripcion: details, tipo,
    ubicacion: { lat: ubicacion.latitude, lng: ubicacion.longitude },
    precisionMetros: Math.round(ubicacion.accuracy),
    fotoBase64, estado: 'pendiente', prioridad: 'sin-evaluar',
  };
  if (offlineEnabled()) {
    if ((await listPending(user.uid)).length >= 20) throw new Error('Hay 20 reportes pendientes. Sincronízalos antes de agregar otro.');
    const id = doc(collection(db, 'reportes')).id;
    await savePending({ id, uid: user.uid, payload, guardadoEn: new Date().toISOString() });
    void syncPendingReports().catch(() => {});
    return { id, pending: true };
  }
  const result = await addDoc(collection(db, 'reportes'), { ...payload, creadoEn: serverTimestamp() });
  return { id: result.id, pending: false };
}
