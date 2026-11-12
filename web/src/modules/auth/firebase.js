
import { initializeApp } from 'firebase/app';

import {
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  getAuth,
  inMemoryPersistence,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';

import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
} from 'firebase/firestore';

import {
  authEmailForName,
  loginEmailForUsername,
  usernameFromName,
} from './identity';

// ==============================================
// CONFIGURACIÓN DE FIREBASE
// ==============================================

const env = import.meta.env;
const emulator = env.VITE_FIREBASE_EMULATORS === 'true';

const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || (emulator ? 'demo-key' : ''),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || (emulator ? 'demo-arca' : ''),
  appId: env.VITE_FIREBASE_APP_ID,
};

const app =
  config.apiKey && config.projectId
    ? initializeApp(config)
    : null;

const secondaryApp = app
  ? initializeApp(config, 'cuentas')
  : null;

export const auth = app ? getAuth(app) : null;

const secondaryAuth = secondaryApp
  ? getAuth(secondaryApp)
  : null;

const db = app ? getFirestore(app) : null;

const secondaryDb = secondaryApp
  ? getFirestore(secondaryApp)
  : null;

// ==============================================
// EMULADORES
// ==============================================

if (app && emulator) {
  connectAuthEmulator(
    auth,
    'http://127.0.0.1:9099',
    { disableWarnings: true }
  );

  connectAuthEmulator(
    secondaryAuth,
    'http://127.0.0.1:9099',
    { disableWarnings: true }
  );

  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectFirestoreEmulator(secondaryDb, '127.0.0.1', 8080);
}

// ==============================================
// INICIAR SESIÓN
// ==============================================

export async function login({ usuario, password }) {
  if (!auth) {
    throw new Error('Firebase no está configurado.');
  }

  const email = loginEmailForUsername(usuario);

  const credential = await signInWithEmailAndPassword(
    auth,
    email,
    password
  );

  try {
    await ensureProfile(credential.user);
    return credential.user;
  } catch (error) {
    await signOut(auth);
    throw error;
  }
}

// ==============================================
// OBTENER PERFIL DE FIRESTORE
// ==============================================

export async function ensureProfile(user) {
  if (!db || !user) {
    throw new Error('No existe una sesión válida.');
  }

  const reference = doc(db, 'usuarios', user.uid);
  const snapshot = await getDoc(reference);

  if (!snapshot.exists()) {
    const error = new Error(
      'La cuenta existe en Authentication, pero no tiene perfil en Firestore.'
    );
    error.code = 'account/missing-profile';
    throw error;
  }

  const profile = snapshot.data();

  if (profile.uid !== user.uid) {
    const error = new Error(
      'El UID del perfil no coincide con Authentication.'
    );
    error.code = 'account/invalid-profile';
    throw error;
  }

  const validRoles = [
    'admin',
    'citizen',
    'water-operator',
    'civil-protection',
    'maintenance-crew',
  ];

  if (!validRoles.includes(profile.role)) {
    const error = new Error(
      'El usuario no tiene un rol válido.'
    );
    error.code = 'account/invalid-role';
    throw error;
  }

  return profile;
}

// ==============================================
// REGISTRO AUTOMÁTICO DE CIUDADANOS
// ==============================================

export async function register(data) {
  if (!auth || !db) {
    throw new Error('Firebase no está configurado.');
  }

  const nombre = String(data.nombre ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  const usuario = usernameFromName(nombre);
  const email = String(data.email ?? '').trim().toLowerCase();
  const authEmail = authEmailForName(nombre);

  if (!email || !data.password) {
    const error = new Error('Completa todos los campos.');
    error.code = 'account/incomplete-data';
    throw error;
  }

  let credential;

  try {
    credential = await createUserWithEmailAndPassword(
      auth,
      authEmail,
      data.password
    );
  } catch (error) {
    if (error.code !== 'auth/email-already-in-use') {
      throw error;
    }

    // Recuperar un registro que quedó incompleto.
    credential = await signInWithEmailAndPassword(
      auth,
      authEmail,
      data.password
    );
  }

  const reference = doc(db, 'usuarios', credential.user.uid);

  try {
    await setDoc(reference, {
      uid: credential.user.uid,
      nombre,
      usuario,
      email,
      authEmail,
      role: 'citizen',
      tipo: 'comun',
      creadoEn: serverTimestamp(),
    });

    return {
      uid: credential.user.uid,
      nombre,
      usuario,
      role: 'citizen',
    };
  } catch (error) {
    console.error(
      'Error al guardar perfil ciudadano:',
      error.code,
      error.message
    );

    await signOut(auth);
    throw error;
  }
}

// ==============================================
// CREAR CUENTAS DESDE ADMINISTRACIÓN
// ==============================================

async function createManagedAccount(data) {
  if (!secondaryAuth || !db) {
    throw new Error('Firebase no está configurado.');
  }

  const nombre = String(data.nombre ?? '')
    .trim()
    .replace(/\s+/g, ' ');

  const usuario = usernameFromName(nombre);
  const authEmail = authEmailForName(nombre);
  const email = String(data.email ?? '').trim().toLowerCase();
  const role = data.role;

  const validRoles = [
    'citizen',
    'water-operator',
    'civil-protection',
    'maintenance-crew',
  ];

  if (!validRoles.includes(role)) {
    const error = new Error('Rol no permitido.');
    error.code = 'account/invalid-role';
    throw error;
  }

  await setPersistence(secondaryAuth, inMemoryPersistence);

  try {
    const credential = await createUserWithEmailAndPassword(
      secondaryAuth,
      authEmail,
      data.password
    );

    const reference = doc(
      db,
      'usuarios',
      credential.user.uid
    );

    await setDoc(reference, {
      uid: credential.user.uid,
      nombre,
      usuario,
      email,
      authEmail,
      role,
      tipo: role === 'citizen' ? 'comun' : 'fijo',
      ...(role === 'maintenance-crew'
        ? { operadorUid: 'WePWGhGitzWeggBe76Z8Av4o3yH3' }
        : {}),
      creadoEn: serverTimestamp(),
    });

    return { nombre, usuario };
  } finally {
    await signOut(secondaryAuth);
  }
}

// ==============================================
// OPERACIONES ADMINISTRATIVAS
// ==============================================

export async function callAccount(name, data = {}) {
  if (!auth?.currentUser) {
    throw new Error('Debes iniciar sesión.');
  }

  if (name === 'createManagedAccount') {
    // La autorización definitiva debe trasladarse
    // a una Cloud Function con Firebase Admin SDK.
    return createManagedAccount(data);
  }

  if (name === 'listAccounts') {
    const constraints = [
      orderBy('usuario'),
      limit(26),
    ];

    if (data.cursor) {
      constraints.push(startAfter(data.cursor));
    }

    const snapshot = await getDocs(
      query(collection(db, 'usuarios'), ...constraints)
    );

    const accounts = snapshot.docs
      .slice(0, 25)
      .map((entry) => entry.data());

    return {
      accounts,
      next: snapshot.size > 25
        ? accounts.at(-1).usuario
        : null,
    };
  }

  throw new Error('Operación desconocida.');
}

// ==============================================
// MENSAJES DE ERROR
// ==============================================

export function accountError(error) {
  if (error.code?.startsWith('account/')) {
    return error.message;
  }

  if ([
    'auth/invalid-credential',
    'auth/user-not-found',
    'auth/wrong-password',
  ].includes(error.code)) {
    return 'Usuario o contraseña incorrectos.';
  }

  if (error.code === 'auth/email-already-in-use') {
    return 'Ese nombre de usuario ya está registrado.';
  }

  if (error.code === 'auth/weak-password') {
    return 'La contraseña debe tener al menos 8 caracteres.';
  }

  if (error.code === 'auth/operation-not-allowed') {
    return 'El acceso con correo y contraseña no está habilitado.';
  }

  if (error.code === 'auth/too-many-requests') {
    return 'Demasiados intentos. Inténtalo más tarde.';
  }

  if (error.code === 'permission-denied') {
    return 'Firestore rechazó el registro. Revisa las reglas publicadas.';
  }

  return 'No se pudo completar la solicitud.';
}
