import { auth, attachProfile } from './accounts.js';

const email = process.argv[2];
if (!email) throw new Error('Indica el correo de una cuenta administrativa existente en Firebase Auth.');

const user = await auth.getUserByEmail(email);
const role = user.customClaims?.role;
if (role && role !== 'admin') throw new Error('La cuenta ya pertenece a otro rol.');
const profile = user.customClaims?.username
  ? user.customClaims
  : await attachProfile(user, 'admin');
console.log(`Usuario administrador: ${profile.username}`);
