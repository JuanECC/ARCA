import { auth } from '../auth/firebase';
import { doc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { compressPhoto } from './photoUtils';

const db = auth?.app ? getFirestore(auth.app) : null;
const ZONES = ['centro', 'norte', 'sur', 'poniente', 'rural'];
const profileRef = (uid) => doc(db, 'usuarios', uid, 'configuracion', 'perfil');

export function isCitizenProfileComplete(profile) {
  if (!profile) return false;
  const address = String(profile.address || '').trim();
  const phone = String(profile.phone || '').replace(/\D/g, '');
  return address.length >= 8 && address.length <= 180
    && ZONES.includes(profile.zone)
    && /^\d{5}$/.test(String(profile.zipCode || ''))
    && /^\d{10,13}$/.test(phone)
    && typeof profile.receiveAlerts === 'boolean'
    && typeof profile.sectorId === 'string' && profile.sectorId.length > 0;
}

export function subscribeCitizenProfile(onChange, onError) {
  const uid = auth?.currentUser?.uid;
  if (!db || !uid) {
    onError?.(new Error('No hay una sesión válida para consultar el perfil.'));
    return () => {};
  }
  return onSnapshot(profileRef(uid), snap => onChange(snap.exists() ? snap.data() : null), onError);
}

export async function saveCitizenProfile(values, photoFile = null, currentPhoto = null) {
  const uid = auth?.currentUser?.uid;
  if (!db || !uid) throw new Error('Debes iniciar sesión.');
  const address = String(values.address || '').trim().replace(/\s+/g, ' ');
  const zone = String(values.zone || '');
  const zipCode = String(values.zipCode || '').trim();
  const phone = String(values.phone || '').replace(/\D/g, '');
  const receiveAlerts = Boolean(values.receiveAlerts);
  const sectorId = String(values.sectorId || '').trim();
  const proposed = { address, zone, zipCode, phone, receiveAlerts, sectorId };
  if (!isCitizenProfileComplete(proposed)) {
    throw new Error('Completa dirección, zona, sector de agua, código postal y teléfono.');
  }
  const fotoBase64 = photoFile ? await compressPhoto(photoFile) : (currentPhoto || null);
  if (fotoBase64 && (fotoBase64.length > 170000 || !fotoBase64.startsWith('data:image/webp;base64,'))) {
    throw new Error('La foto del perfil supera el tamaño permitido.');
  }
  await setDoc(profileRef(uid), { ...proposed, fotoBase64, actualizadoEn: serverTimestamp() });
}
