import { randomBytes } from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp();

export const auth = getAuth();
export const profiles = getFirestore().collection('usernames');

export async function attachProfile(user, role, fixedUsername) {
  const stem = user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 18);
  const username = fixedUsername ?? `${stem || 'arca'}-${randomBytes(6).toString('hex')}`;
  const profile = { uid: user.uid, email: user.email, username, role };
  const reference = profiles.doc(username);
  await reference.create(profile);
  try {
    await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role, username });
  } catch (error) {
    await reference.delete();
    throw error;
  }
  return profile;
}
