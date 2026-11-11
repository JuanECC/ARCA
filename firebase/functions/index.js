import { HttpsError, onCall } from 'firebase-functions/v2/https';
import { auth, profiles, attachProfile } from './accounts.js';

const managedRoles = new Set(['citizen', 'water-operator', 'civil-protection']);
const options = { maxInstances: 10 };

function credentials(data) {
  const email = typeof data?.email === 'string' ? data.email.trim().toLowerCase() : '';
  const password = data?.password;
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    throw new HttpsError('invalid-argument', 'Ingresa un correo válido y una contraseña de 8 a 128 caracteres.');
  }
  return { email, password };
}

async function createAccount(data, role) {
  let user;
  try {
    user = await auth.createUser(credentials(data));
    const profile = await attachProfile(user, role);
    return { username: profile.username };
  } catch (error) {
    if (user) await auth.deleteUser(user.uid);
    if (error instanceof HttpsError) throw error;
    if (error.code === 'auth/email-already-exists') {
      throw new HttpsError('already-exists', 'Ya existe una cuenta con ese correo.');
    }
    throw new HttpsError('internal', 'No se pudo crear la cuenta. Inténtalo nuevamente.');
  }
}

function requireAdmin(request) {
  if (request.auth?.token.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Se requiere una cuenta de administración.');
  }
}

export const registerCitizen = onCall(options, ({ data }) => createAccount(data, 'citizen'));

export const createManagedAccount = onCall(options, (request) => {
  requireAdmin(request);
  const role = request.data?.role;
  if (!managedRoles.has(role)) throw new HttpsError('invalid-argument', 'Selecciona un rol válido.');
  return createAccount(request.data, role);
});

export const listAccounts = onCall(options, async (request) => {
  requireAdmin(request);
  const cursor = request.data?.cursor;
  let query = profiles.orderBy('username').limit(26);
  if (typeof cursor === 'string' && cursor.length <= 40) query = query.startAfter(cursor);
  const snapshot = await query.get();
  const accounts = snapshot.docs.slice(0, 25).map((doc) => doc.data());
  return { accounts, next: snapshot.size > 25 ? accounts.at(-1).username : null };
});

export const loginWithUsername = onCall(options, async ({ data }) => {
  const username = typeof data?.username === 'string' ? data.username.trim().toLowerCase() : '';
  const password = data?.password;
  const invalid = () => new HttpsError('unauthenticated', 'Usuario o contraseña incorrectos.');
  if (!/^[a-z0-9]{1,18}-[a-f0-9]{12}$/.test(username)
      || typeof password !== 'string' || !password || password.length > 128) throw invalid();

  const profile = (await profiles.doc(username).get()).data();
  if (!profile) throw invalid();

  const host = process.env.FIREBASE_AUTH_EMULATOR_HOST;
  const endpoint = host ? `http://${host}/identitytoolkit.googleapis.com` : 'https://identitytoolkit.googleapis.com';
  const key = host ? 'demo-key' : process.env.FIREBASE_WEB_API_KEY;
  if (!key) throw new HttpsError('unavailable', 'El servicio de acceso no está configurado.');
  const url = new URL('/v1/accounts:signInWithPassword', 'https://identitytoolkit.googleapis.com');
  url.searchParams.set('key', key);
  let response;
  try {
    response = await fetch(`${endpoint}${url.pathname}${url.search}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: profile.email, password, returnSecureToken: true }),
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    throw new HttpsError('unavailable', 'El servicio de acceso no está disponible. Inténtalo nuevamente.');
  }
  if (response.status >= 500 || response.status === 429) {
    throw new HttpsError('unavailable', 'El servicio de acceso no está disponible. Inténtalo nuevamente.');
  }
  if (!response.ok || (await response.json()).localId !== profile.uid) throw invalid();

  return { token: await auth.createCustomToken(profile.uid) };
});
