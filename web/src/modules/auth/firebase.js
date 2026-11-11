
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

// EMULADORES
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

// INICIO DE SESIÓN
export async function login({ usuario, password }) {
  if (!auth) {
    throw new Error('Firebase no está configurado.');
  }

  const username = usernameFromName(usuario);
  const email = loginEmailForUsername(username);

  console.log('Iniciando sesión:', username);
  console.log('Correo de autenticación:', email);
  console.log('Proyecto Firebase:', auth.app.options.projectId);

  let credential;

  try {
    credential = await signInWithEmailAndPassword(
      auth,
      email,
      password
    );
  } catch (error) {
    console.error('Error Firebase Auth:', error.code);
    console.error('Detalle:', error.message);
    throw error;
  }

  try {
    const profile = await ensureProfile(credential.user);

    console.log('Sesión iniciada correctamente');
    console.log('Rol:', profile.role);

    return credential.user;
  } catch (error) {
    await signOut(auth);
    throw error;
  }
}

// CONSULTAR PERFIL EN FIRESTORE
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
      'El UID del perfil no coincide con Firebase Authentication.'
    );
    error.code = 'account/invalid-profile';
    throw error;
  }

  if (!profile.role) {
    const error = new Error(
      'El usuario no tiene un rol asignado.'
    );
    error.code = 'account/missing-role';
    throw error;
  }

  return profile;
}

// CREACIÓN DE CUENTAS
async function createAccount(data, role, administrative) {
  if (!secondaryAuth) {
    throw new Error('Firebase no está configurado.');
  }

  const nombre = data.nombre.trim().replace(/\s+/g, ' ');
  const usuario = usernameFromName(nombre);
  const authEmail = authEmailForName(nombre);
  const email = data.email.trim().toLowerCase();

  await setPersistence(
    secondaryAuth,
    inMemoryPersistence
  );

  try {
    let credential;

    try {
      credential = await createUserWithEmailAndPassword(
        secondaryAuth,
        authEmail,
        data.password
      );
    } catch (error) {
      if (error.code !== 'auth/email-already-in-use') {
        throw error;
      }

      // Recuperar un registro interrumpido.
      credential = await signInWithEmailAndPassword(
        secondaryAuth,
        authEmail,
        data.password
      );
    }

    const database = administrative ? db : secondaryDb;

    const reference = doc(
      database,
      'usuarios',
      credential.user.uid
    );

    if ((await getDoc(reference)).exists()) {
      const error = new Error(
        'Ese nombre de usuario ya está registrado.'
      );
      error.code = 'account/name-taken';
      throw error;
    }

    await setDoc(reference, {
      uid: credential.user.uid,
      email,
      authEmail,
      nombre,
      usuario,
      role,
      ...(role === 'maintenance-crew'
        ? {
            operadorUid:
              'WePWGhGitzWeggBe76Z8Av4o3yH3',
          }
        : {}),
      tipo: role === 'citizen' ? 'comun' : 'fijo',
      creadoEn: serverTimestamp(),
    });

    return { nombre, usuario };
  } finally {
    await signOut(secondaryAuth);
  }
}

// REGISTRO CIUDADANO
export async function register(data) {
  const result = await createAccount(
    data,
    'citizen',
    false
  );

  await login({
    usuario: result.usuario,
    password: data.password,
  });
}

// OPERACIONES ADMINISTRATIVAS
export async function callAccount(name, data = {}) {
  if (!auth?.currentUser) {
    throw new Error('Debes iniciar sesión.');
  }

  if (name === 'createManagedAccount') {
    // Provisional: migrar a Cloud Functions
    // con autorización del administrador.
    return createAccount(data, data.role, true);
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
      query(
        collection(db, 'usuarios'),
        ...constraints
      )
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

// ERRORES
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
    return 'El inicio de sesión no está habilitado.';
  }

  if (error.code === 'auth/too-many-requests') {
    return 'Demasiados intentos. Inténtalo más tarde.';
  }

  if (error.code === 'permission-denied') {
    return 'No tienes permisos para realizar esta operación.';
  }

  return 'No se pudo completar la solicitud.';
}
