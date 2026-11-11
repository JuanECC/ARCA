import { initializeApp } from 'firebase/app';
import {
  connectAuthEmulator, createUserWithEmailAndPassword, getAuth, signInWithEmailAndPassword,
} from 'firebase/auth';
import { connectFunctionsEmulator, getFunctions, httpsCallable } from 'firebase/functions';

const env = import.meta.env;
const emulator = env.VITE_FIREBASE_EMULATORS === 'true';
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY || (emulator ? 'demo-key' : ''),
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: env.VITE_FIREBASE_PROJECT_ID || (emulator ? 'demo-arca' : ''),
  appId: env.VITE_FIREBASE_APP_ID,
};

const app = config.apiKey && config.projectId ? initializeApp(config) : null;
export const auth = app ? getAuth(app) : null;
const functions = app ? getFunctions(app) : null;

if (app && emulator) {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099');
  connectFunctionsEmulator(functions, '127.0.0.1', 5001);
}

export async function callAccount(name, data) {
  if (!functions) throw new Error('Firebase aún no está configurado.');
  return (await httpsCallable(functions, name)(data)).data;
}

export async function login({ email, password }) {
  if (!auth) throw new Error('Firebase aún no está configurado.');
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function register({ email, password }) {
  if (!auth) throw new Error('Firebase aún no está configurado.');
  await createUserWithEmailAndPassword(auth, email.trim(), password);
}

export function accountError(error) {
  if (error.code === 'auth/invalid-credential' || error.code === 'auth/user-not-found'
      || error.code === 'auth/wrong-password') return 'Correo o contraseña incorrectos.';
  if (error.code === 'auth/email-already-in-use') return 'Ya existe una cuenta con ese correo.';
  if (error.code === 'auth/weak-password') return 'La contraseña debe tener al menos 6 caracteres.';
  if (error.code === 'auth/operation-not-allowed') return 'Habilita Correo/Contraseña en Firebase Authentication.';
  if (error.code === 'auth/too-many-requests') return 'Demasiados intentos. Inténtalo más tarde.';
  if (error.code === 'functions/permission-denied') return 'Esta cuenta aún no tiene permiso para gestionar usuarios.';
  return 'No se pudo completar la solicitud. Inténtalo nuevamente.';
}
