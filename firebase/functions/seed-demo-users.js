const project = 'demo-arca';
const localAuth = '127.0.0.1:9099';
const localFirestore = '127.0.0.1:8080';

if (process.env.GCLOUD_PROJECT !== project
    || process.env.FIREBASE_AUTH_EMULATOR_HOST !== localAuth
    || process.env.FIRESTORE_EMULATOR_HOST !== localFirestore) {
  throw new Error('Las cuentas de prueba requieren Auth y Firestore locales en el proyecto demo-arca.');
}

const { auth, attachProfile } = await import('./accounts.js');

const password = 'HidroDemo2026!';
const users = [
  ['citizen', 'ciudadano-000000000001'],
  ['admin', 'admin-000000000002'],
  ['water-operator', 'agua-000000000003'],
  ['civil-protection', 'proteccioncivil-000000000004'],
];

for (const [role, username] of users) {
  const uid = 'demo-' + role;
  const email = role + '@arca.example.test';
  const user = await auth.getUser(uid).catch((error) => {
    if (error.code !== 'auth/user-not-found') throw error;
    return auth.createUser({ uid, email, password });
  });

  if (user.email !== email) throw new Error('El UID de prueba ya está asociado a otro correo.');
  if (user.customClaims?.role !== role || user.customClaims?.username !== username) {
    await attachProfile(user, role, username);
  }

  console.log(role + ' · ' + username);
}
