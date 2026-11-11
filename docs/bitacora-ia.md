# Bitácora de IA

## 2026-11-11 · Módulo 01 · Arranque

- **Solicitud.** Preparar la estructura de carpetas, el README principal y la conexión con GitHub desde el entorno de desarrollo.
- **Asistente.** Codex.
- **Aporte.** Revisión del directorio de trabajo, consulta de referencias del remoto, propuesta de estructura inicial y redacción de documentación.
- **Decisión.** Separar la aplicación web de la configuración y lógica de Firebase. Mantener ambas carpetas como puntos de entrada para los siguientes módulos.
- **Verificación.** El directorio local estaba vacío y GitHub respondió sin referencias publicadas. La compilación y las pruebas aplicarán cuando exista código ejecutable.

## 2026-11-11 · Preparación de módulos

- **Solicitud.** Crear primero la estructura de carpetas para el login, el registro administrativo y los paneles de ciudadanía, operación de agua y Protección Civil.
- **Aporte de Codex.** Creó las carpetas por módulo y actualizó el README con sus responsabilidades.
- **Decisión.** Reservar un módulo de autenticación común y un panel de administración dedicado al registro de cuentas ciudadanas. Ubicar las operaciones privilegiadas y las reglas de acceso en Firebase.
- **Verificación.** Se revisaron las rutas y el diff. La primera interfaz se implementará en el módulo de login.

## 2026-11-11 · Módulo de acceso

- **Solicitud.** Crear registro con correo y contraseña, generar un usuario, iniciar sesión con ese usuario y abrir un panel por rol.
- **Aporte de Codex.** Implementó la interfaz React con los cuatro CSS adjuntos como base visual, Firebase Auth, la correspondencia privada de usuario a correo y el aprovisionamiento administrativo.
- **Decisión.** El registro público asigna Ciudadanía. Administración selecciona el rol al crear cuentas ciudadanas o institucionales. La primera cuenta de administración se configura mediante un comando privilegiado. Los tres paneles operativos contienen sus vistas iniciales.
- **Verificación.** Compilación de Vite y sintaxis de Functions correctas. En los emuladores se comprobó el registro, el login de los cuatro roles, el rechazo de contraseña incorrecta, los permisos de administración y el listado de cuentas.

## 2026-11-11 · Cuentas de prueba de acceso

- **Solicitud.** Preparar cuatro cuentas fijas de prueba, una por rol.
- **Aporte de Codex.** Agregó un comando reproducible para crear las cuentas en el emulador y documentó los accesos en el README.
- **Verificación.** Las cuatro cuentas iniciaron sesión en Firebase Auth local y recibieron el rol esperado. Solo Administración pudo consultar el listado de usuarios. El despliegue en arca-e7c40 sigue pendiente por permisos del proyecto.

## 2026-11-11 · Vinculación de cuentas de consola

- **Solicitud.** Usar los cuatro correos ya creados manualmente en Firebase Authentication.
- **Aporte de Codex.** Preparó un comando que valida las cuentas existentes, asigna sus roles e imprime sus nombres de usuario sin cambiar sus contraseñas.
- **Verificación.** Sintaxis y protección contra ejecución en otro proyecto comprobadas. La ejecución en arca-e7c40 queda pendiente de acceso administrativo.
