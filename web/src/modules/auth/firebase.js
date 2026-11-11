import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth, signInWithCustomToken } from 'firebase/auth';
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

export async function login(data) {
  const { token } = await callAccount('loginWithUsername', data);
  await signInWithCustomToken(auth, token);
}

const recoverable = new Set([
  'functions/invalid-argument', 'functions/already-exists', 'functions/unauthenticated',
  'functions/permission-denied', 'functions/unavailable',
]);

export function accountError(error) {
  if (!functions || recoverable.has(error.code)) return error.message;
  return 'No se pudo completar la solicitud. Inténtalo nuevamente.';
}
