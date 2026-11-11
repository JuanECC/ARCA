# HidroAlerta Veracruz · ARCA

**Del reporte ciudadano a la acción preventiva.**

Proyecto para el Reto 3 del hackathon, Agua y lluvia. Busca conectar a la ciudadanía, Protección Civil y organismos operadores de agua en Veracruz mediante reportes geolocalizados, seguimiento institucional e información preventiva.

## Estado

El proyecto está en el módulo de arranque. La aplicación, Firebase y las integraciones externas están pendientes de implementación. Esta entrega define las carpetas de cada módulo y su responsabilidad.

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

El primer módulo de implementación será el login. La navegación usará el rol asignado a la cuenta y el backend verificará los permisos de cada operación. Después se implementarán el registro administrativo y los paneles.


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
