export const roleLabels = {
  citizen: 'Ciudadanía',
  'water-operator': 'Operación de Agua',
  'civil-protection': 'Protección Civil',
  admin: 'Administración',
};

const demoRoles = {
  'admin@arca.example.com': 'admin',
  'agua@arca.example.com': 'water-operator',
  'proteccioncivil@arca.example.com': 'civil-protection',
};

export function displayRole(user, claims) {
  if (claims?.role) return claims.role;
  return demoRoles[user.email?.toLowerCase()] ?? 'citizen';
}
