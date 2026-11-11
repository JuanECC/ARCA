import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator, createUserWithEmailAndPassword, deleteUser, getAuth,
  inMemoryPersistence, setPersistence, signInWithEmailAndPassword, signOut,
} from 'firebase/auth';
import {
  collection, connectFirestoreEmulator, doc, getDoc, getDocs, getFirestore, limit,
  orderBy, query, serverTimestamp, setDoc, startAfter,
} from 'firebase/firestore';

const env = import.meta.env;
const emulator = env.VITE_FIREBASE_EMULATORS === 'true';
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || (emulator ? 'demo-key' : ''),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || (emulator ? 'demo-arca' : ''),
  appId: env.VITE_FIREBASE_APP_ID,
};
const app = config.apiKey && config.projectId ? initializeApp(config) : null;
const secondaryApp = app ? initializeApp(config, 'cuentas') : null;
export const auth = app ? getAuth(app) : null;
const secondaryAuth = secondaryApp ? getAuth(secondaryApp) : null;
const db = app ? getFirestore(app) : null;
const secondaryDb = secondaryApp ? getFirestore(secondaryApp) : null;

if (app && emulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectAuthEmulator(secondaryAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFirestoreEmulator(secondaryDb, '127.0.0.1', 8080);
}

const fixedRoles = {
  '6K9PgDGfgrhjn6wWTXQgvMzA8BB2': 'maintenance-crew',
  lJ9W2QteobbETqMoPBonAFfzMgh1: 'admin',
  WePWGhGitzWeggBe76Z8Av4o3yH3: 'water-operator',
  '0MgDjIllJTWIgLPyKCjA7EQNBSw1': 'civil-protection',
};

export async function login({ email, password }) {
  if (!auth) throw new Error('Firebase aún no está configurado.');
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function ensureProfile(user) {
  const reference = doc(db, 'usuarios', user.uid);
  let snapshot = await getDoc(reference);
  if (!snapshot.exists()) {
    const role = fixedRoles[user.uid] ?? 'citizen';
    try {
      await setDoc(reference, {
        uid: user.uid, email: user.email, nombre: user.displayName || '',
        role, tipo: role === 'citizen' ? 'comun' : 'fijo', creadoEn: serverTimestamp(),
        ...(role === 'maintenance-crew' ? { operadorUid: 'WePWGhGitzWeggBe76Z8Av4o3yH3' } : {}),
      });
    } catch (error) {
      snapshot = await getDoc(reference);
      if (!snapshot.exists()) throw error;
    }
    snapshot = await getDoc(reference);
  }
  return snapshot.data();
}

async function createAccount(data, role, administrative) {
  if (!secondaryAuth) throw new Error('Firebase aún no está configurado.');
  await setPersistence(secondaryAuth, inMemoryPersistence);
  const email = data.email.trim().toLowerCase();
  const nombre = data.nombre.trim();
  const credential = await createUserWithEmailAndPassword(secondaryAuth, email, data.password);
  try {
    await setDoc(doc(administrative ? db : secondaryDb, 'usuarios', credential.user.uid), {
      uid: credential.user.uid, email, nombre, role,
      ...(role === 'maintenance-crew' ? { operadorUid: 'WePWGhGitzWeggBe76Z8Av4o3yH3' } : {}),
      tipo: role === 'citizen' ? 'comun' : 'fijo', creadoEn: serverTimestamp(),
    });
  } catch (error) {
    try { await deleteUser(credential.user); } catch { /* The account can be removed from Firebase Authentication. */ }
    throw error;
  } finally {
    await signOut(secondaryAuth);
  }
  return { email };
}

export async function register(data) {
  await createAccount(data, 'citizen', false);
  await login(data);
}

export async function callAccount(name, data) {
  if (name === 'createManagedAccount') {
    return createAccount(data, data.role, true);
  }
  if (name === 'listAccounts') {
    const constraints = [orderBy('email'), limit(26)];
    if (data.cursor) constraints.push(startAfter(data.cursor));
    const snapshot = await getDocs(query(collection(db, 'usuarios'), ...constraints));
    const accounts = snapshot.docs.slice(0, 25).map((entry) => entry.data());
    return { accounts, next: snapshot.size > 25 ? accounts.at(-1).email : null };
  }
  throw new Error('Operación desconocida.');
}

export function accountError(error) {
  if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found'
      || error.code === 'auth/wrong-password') return 'Correo o contraseña incorrectos.';
  if (error.code === 'auth/email-already-in-use') return 'Ya existe una cuenta con ese correo.';
  if (error.code === 'auth/weak-password') return 'La contraseña debe tener al menos 8 caracteres.';
  if (error.code === 'auth/operation-not-allowed') return 'Habilita Correo/Contraseña en Firebase Authentication.';
  if (error.code === 'auth/too-many-requests') return 'Demasiados intentos. Inténtalo más tarde.';
  if (error.code === 'permission-denied') return 'Esta cuenta no tiene permiso para realizar esta operación.';
  return 'No se pudo completar la solicitud. Inténtalo nuevamente.';
}
