
export function usernameFromName(value) {
  const username = String(value ?? '')
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (username.length < 2 || username.length > 64) {
    const error = new Error(
      'El nombre de usuario debe tener entre 2 y 64 caracteres.'
    );

    error.code = 'account/invalid-name';
    throw error;
  }

  return username;
}

// Correo interno para cuentas ciudadanas nuevas.
export function authEmailForName(value) {
  return `${usernameFromName(value)}@usuarios.arca.example.com`;
}

// Identificar el correo de inicio de sesión.
export function loginEmailForUsername(value) {
  const usuario = usernameFromName(value);

  const cuentasInstitucionales = {
    admin: 'admin@arca.example.com',
    agua: 'agua@arca.example.com',
    'proteccion-civil': 'proteccioncivil@arca.example.com',
    mantenimiento: 'cuadrilla@arca.example.com',
  };

  return cuentasInstitucionales[usuario]
    ?? authEmailForName(usuario);
}
