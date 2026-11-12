import { auth } from '../auth/firebase';
import { getFirestore, collection, addDoc, query, orderBy, onSnapshot, serverTimestamp } from 'firebase/firestore';

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
async function compressPhoto(file) {
  if (!file) return null;
  if (!file.type.startsWith('image/')) throw new Error('Selecciona un archivo de imagen.');
  if (file.size > 12 * 1024 * 1024) throw new Error('La foto original no debe superar 12 MB.');
  const objectURL = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = objectURL;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('No se pudo leer la fotografía.');
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Este navegador no permite comprimir fotografías.');
    for (const maxSide of [900, 720, 560, 420]) {
      const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      for (const quality of [0.72, 0.55, 0.4, 0.28]) {
        const dataURL = canvas.toDataURL('image/webp', quality);
        // Algunos navegadores no soportan WebP: canvas devuelve PNG.
        if (!dataURL.startsWith('data:image/webp;base64,')) continue;
        const base64Length = dataURL.length - dataURL.indexOf(',') - 1;
        const estimatedBytes = Math.ceil(base64Length * 3 / 4);
        if (estimatedBytes <= 120 * 1024) return dataURL;
      }
    }
    throw new Error('La imagen es demasiado compleja para comprimirla. Prueba con otra fotografía.');
  } finally {
    URL.revokeObjectURL(objectURL);
  }
}

export async function createCitizenReport({ titulo, descripcion, tipo, ubicacion, foto }) {
  const user = auth?.currentUser;
  if (!user) throw new Error('Debes iniciar sesión para generar un reporte.');
  if (!db) throw new Error('Firebase no está configurado.');
  const title = titulo.trim(), details = descripcion.trim();
  if (title.length < 5 || title.length > 100 || details.length < 10 || details.length > 1500) throw new Error('El título debe tener de 5 a 100 caracteres y la descripción de 10 a 1500.');
  if (!REPORT_TYPES.some(t => t.value === tipo)) throw new Error('Selecciona un tipo de reporte válido.');
  if (!ubicacion || !Number.isFinite(ubicacion.latitude) || !Number.isFinite(ubicacion.longitude) || !Number.isFinite(ubicacion.accuracy) || ubicacion.accuracy < 0 || Math.abs(ubicacion.latitude) > 90 || Math.abs(ubicacion.longitude) > 180) throw new Error('Obtén una ubicación válida antes de enviar.');
  const fotoBase64 = await compressPhoto(foto);
  const result = await addDoc(collection(db, 'reportes'), {
    usuarioUid: user.uid, titulo: title, descripcion: details, tipo,
    ubicacion: { lat: ubicacion.latitude, lng: ubicacion.longitude },
    precisionMetros: Math.round(ubicacion.accuracy),
    fotoBase64, estado: 'pendiente', prioridad: 'sin-evaluar', creadoEn: serverTimestamp(),
  });
  return result.id;
}
