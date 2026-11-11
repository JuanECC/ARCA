# HidroAlerta Veracruz · ARCA

**Del reporte ciudadano a la acción preventiva.**

Proyecto para el Reto 3 del hackathon, Agua y lluvia. Busca conectar a la ciudadanía, Protección Civil y organismos operadores de agua en Veracruz mediante reportes geolocalizados, seguimiento institucional e información preventiva.

## Estado

El módulo de acceso incluye registro ciudadano, login por nombre de usuario y cuatro paneles según el rol. Administración puede crear y consultar cuentas. Los paneles de reportes, agua y Protección Civil son vistas iniciales para sus respectivos módulos.

## Estructura

| Ruta | Responsabilidad prevista |
| --- | --- |
| `web/` | Aplicación React con Vite. Contendrá la interfaz ciudadana, el mapa y los paneles institucionales. |
| `firebase/` | Reglas de Firestore y Storage, configuración de emuladores y funciones backend. |
| `docs/` | Bitácora de IA y futuras decisiones técnicas del proyecto. |

## Desarrollo por módulos

| Carpeta | Responsabilidad prevista |
| --- | --- |
| `web/src/app/` | Entrada de la aplicación, navegación y rutas por rol. |
| `web/src/modules/auth/` | Primera interfaz del proyecto. Inicio de sesión para ciudadanía, operadores de agua, Protección Civil y administración. |
| `web/src/modules/admin/` | Panel para que administración registre cuentas de ciudadanía. |
| `web/src/modules/citizen-reports/` | Panel ciudadano para crear reportes y consultar su historial y estado. |
| `web/src/modules/water-operations/` | Panel para gestionar fugas, desabasto y otras incidencias de suministro. |
| `web/src/modules/civil-protection/` | Panel para revisar reportes de lluvia e inundación y gestionar avisos de su competencia. |
| `firebase/functions/` | Operaciones de backend, como el registro autorizado de cuentas. |
| `firebase/rules/` | Reglas de acceso de Firestore y Storage. |

Firebase Auth conserva el correo y la contraseña. El backend genera un usuario único y asigna el rol a la cuenta mediante custom claims. El registro público siempre asigna Ciudadanía. El panel de Administración permite elegir Ciudadanía, Operación de Agua o Protección Civil. Las cuentas institucionales se aprovisionan con los correos autorizados por el equipo.


La primera demo funcional recorrerá un reporte de fuga desde su captura hasta el cambio a «en atención» por el organismo operador y la consulta del estado por el ciudadano.

## Abrir en Visual Studio Code

Con Git y Visual Studio Code instalados, clona el repositorio una vez publicado el commit inicial. Si ya tienes una copia local, ábrela directamente con **Archivo → Abrir carpeta**.

```powershell
git clone https://github.com/JuanECC/ARCA.git
cd ARCA
code .
```

La vista **Control de código fuente** de VS Code usa el repositorio Git de esa carpeta. GitHub puede solicitar autenticación al publicar cambios. Registra en la [bitácora de IA](docs/bitacora-ia.md) el trabajo asistido y las verificaciones de cada módulo.

## Datos y permisos

Los roles institucionales se asignarán por un mecanismo autorizado. Las reglas del backend protegerán fotos, coordenadas precisas y datos personales. La interfaz identificará por separado los datos simulados, las sugerencias de IA y los avisos institucionales. Si falta una fuente de tandeos confiable, se mostrará «Información no disponible».

## Ejecutar el módulo de acceso

Instala Node.js 22 (22.12 o posterior), un JDK 21 o posterior para Firestore y el CLI oficial de Firebase. Desde la raíz instala las dependencias y arranca los emuladores.

```powershell
npm ci --prefix web
npm ci --prefix firebase/functions
npx firebase-tools emulators:start --project demo-arca --only auth,firestore,functions
```

En una segunda terminal inicia Vite conectado al proyecto de prueba.

```powershell
$env:VITE_FIREBASE_EMULATORS = 'true'
npm run dev --prefix web
```

Para probar Administración, crea una cuenta con correo y contraseña de prueba en **Authentication** en la consola local del emulador. Después asigna el rol y obtén su nombre de usuario desde otra terminal.

```powershell
$env:GCLOUD_PROJECT = 'demo-arca'
$env:FIREBASE_AUTH_EMULATOR_HOST = '127.0.0.1:9099'
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8080'
npm run bootstrap-admin --prefix firebase/functions -- admin@example.test
```

En un proyecto real, habilita el proveedor Correo/Contraseña, crea Firestore y completa los archivos de configuración locales a partir de `web/.env.example` y `firebase/functions/.env.example`. La cuenta de servicio de Functions necesita acceso a Auth y Firestore y permiso para firmar tokens personalizados. Ejecuta el aprovisionamiento inicial con credenciales administrativas de Google y el ID del proyecto. Las cuentas institucionales se crean desde Administración antes de entregar el acceso a sus titulares. El repositorio no contiene credenciales ni cuentas precargadas.

Consulta la documentación de [tokens personalizados de Firebase](https://firebase.google.com/docs/auth/admin/create-custom-tokens).
