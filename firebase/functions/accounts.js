import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

initializeApp();

export const auth = getAuth();
const db = getFirestore();
export const profiles = db.collection('usernames');
export const users = db.collection('usuarios');

export async function attachProfile(user, role, fixedUsername) {
  const stem = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18);
  const username = fixedUsername ?? `${stem || 'arca'}-${randomBytes(6).toString('hex')}`;
  const mapping = { uid: user.uid, email: user.email, username, role };
  const profile = {
    ...mapping,
    nombre: user.displayName || '',
    tipo: role === 'citizen' ? 'comun' : 'fijo',
    creadoEn: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.create(profiles.doc(username), mapping);
  batch.create(users.doc(user.uid), profile);
  await batch.commit();
  try {
    await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role, username });
  } catch (error) {
    const cleanup = db.batch();
    cleanup.delete(profiles.doc(username));
    cleanup.delete(users.doc(user.uid));
    await cleanup.commit();
    throw error;
  }
  return profile;
}
