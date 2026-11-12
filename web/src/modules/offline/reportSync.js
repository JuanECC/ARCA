import { doc, getFirestore, runTransaction, serverTimestamp } from 'firebase/firestore';
import { auth } from '../auth/firebase';
import { isCitizenProfileComplete } from '../citizen-reports/profileService';
import { listPending, savePending, removePending } from './outboxStore';

let running = false;
export async function syncPendingReports() {
  const uid = auth?.currentUser?.uid;
  if (running || !uid || !navigator.onLine) return;
  running = true;
  try {
    const db = getFirestore(auth.app);
    for (const item of await listPending(uid)) {
      if (!navigator.onLine || auth.currentUser?.uid !== uid) break;
      try {
        await runTransaction(db, async transaction => {
          if (auth.currentUser?.uid !== uid) throw new Error('Vuelve a iniciar sesión con la cuenta que creó el reporte.');
          const reference = doc(db, 'reportes', item.id);
          const existing = await transaction.get(reference);
          if (existing.exists()) {
            if (existing.data().usuarioUid !== uid) throw new Error('El identificador está ocupado. Conserva el borrador y solicita revisión.');
            return;
          }
          const account = await transaction.get(doc(db, 'usuarios', uid));
          const profile = await transaction.get(doc(db, 'usuarios', uid, 'configuracion', 'perfil'));
          if (account.data()?.role !== 'citizen' || !isCitizenProfileComplete(profile.data())) {
            throw new Error('Completa tu perfil ciudadano para enviar este reporte.');
          }
          transaction.set(reference, {
            ...item.payload, usuarioUid: uid, autorNombre: account.data().nombre,
            creadoEn: serverTimestamp(),
          });
        });
        await removePending(item.id);
        window.dispatchEvent(new CustomEvent('arca-report-sent', { detail: item.payload.titulo }));
      } catch (error) {
        await savePending({ ...item, error: error.code === 'permission-denied'
          ? 'Firebase rechazó el envío. Revisa tu cuenta y perfil antes de reintentar.'
          : error.code === 'unavailable' ? 'Sin comunicación con Firebase. El reporte sigue guardado.'
          : error.message });
        break;
      }
    }
  } finally {
    running = false;
  }
}
