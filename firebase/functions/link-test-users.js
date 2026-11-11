const project = 'arca-e7c40';
process.env.GCLOUD_PROJECT ??= project;
if (process.env.GCLOUD_PROJECT !== project
    || process.env.FIREBASE_AUTH_EMULATOR_HOST
    || process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Este comando requiere GCLOUD_PROJECT=arca-e7c40 y los emuladores desactivados.');
}

const { auth, profiles, users, attachProfile } = await import('./accounts.js');
const assignments = [
  ['ciudadano@arca.example.com', 'citizen'],
  ['admin@arca.example.com', 'admin'],
  ['agua@arca.example.com', 'water-operator'],
  ['proteccioncivil@arca.example.com', 'civil-protection'],
];

const accounts = await Promise.all(assignments.map(async ([email, role]) => {
  const user = await auth.getUserByEmail(email);
  const claims = user.customClaims ?? {};

  if (user.disabled || !user.providerData.some(({ providerId }) => providerId === 'password')) {
    throw new Error('La cuenta requiere acceso activo con correo y contraseña: ' + email);
  }

  if (claims.role && claims.role !== role) {
    throw new Error('La cuenta ya tiene otro rol: ' + email);
  }

  if (claims.username) {
    const profile = (await profiles.doc(claims.username).get()).data();
    if (claims.role !== role || profile?.uid !== user.uid || profile.email !== email
        || profile.role !== role || profile.username !== claims.username) {
      throw new Error('Revisa la vinculación existente de ' + email + ' antes de continuar.');
    }
  }

  return { user, role, username: claims.username };
}));

for (const { user, role, username } of accounts) {
  const login = username ?? (await attachProfile(user, role)).username;
  if (username) {
    const reference = users.doc(user.uid);
    const existing = await reference.get();
    if (!existing.exists) {
      await reference.create({
        uid: user.uid,
        email: user.email,
        username,
        role,
        nombre: user.displayName || '',
        tipo: role === 'citizen' ? 'comun' : 'fijo',
        creadoEn: new Date(),
      });
    } else if (existing.data().username !== username || existing.data().role !== role) {
      throw new Error('El perfil de usuario no coincide con la cuenta: ' + user.email);
    }
  }
  console.log(user.email + ' · ' + role + ' · ' + login);
}
