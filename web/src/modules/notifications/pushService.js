// ARCA · Notificaciones push: registra este celular en Firebase Cloud Messaging.
// El token se guarda en `pushTokens/{token}` con el sector del usuario; la función
// sendPushAlert lo usa para avisar cuando se publica algo en `notices`.
import { getMessaging, getToken, isSupported } from 'firebase/messaging';
import { doc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth } from '../auth/firebase';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY;

export async function pushAvailable() {
  if (!auth?.app || !VAPID_KEY || !('serviceWorker' in navigator) || !('Notification' in window)) return false;
  return isSupported().catch(() => false);
}

export const pushPermission = () => ('Notification' in window ? Notification.permission : 'denied');

// Espera a que el service worker de notificaciones quede activo
function activated(registration) {
  const worker = registration.installing || registration.waiting;
  if (!worker || registration.active) return Promise.resolve(registration);
  return new Promise((resolve) => {
    worker.addEventListener('statechange', () => worker.state === 'activated' && resolve(registration));
  });
}

// Registra este celular. Con ask=true pide el permiso (debe llamarse desde un toque del usuario).
// Devuelve: 'granted' | 'default' | 'denied' | 'no-disponible'
export async function enablePush({ sectorId = '', ask = false } = {}) {
  if (!(await pushAvailable())) return 'no-disponible';
  if (ask && Notification.permission === 'default') await Notification.requestPermission();
  if (Notification.permission !== 'granted') return Notification.permission;

  const registration = await activated(await navigator.serviceWorker.register('/push-sw.js', { scope: '/push/' }));
  const token = await getToken(getMessaging(auth.app), { vapidKey: VAPID_KEY, serviceWorkerRegistration: registration });
  if (!token || !auth.currentUser) return 'default';

  // Se actualiza en cada inicio para que el sector esté al día
  await setDoc(doc(getFirestore(auth.app), 'pushTokens', token), {
    uid: auth.currentUser.uid,
    sectorId: sectorId || '',
    updatedAt: serverTimestamp(),
  });
  return 'granted';
}
