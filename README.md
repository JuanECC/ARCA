# HidroAlerta Veracruz · ARCA

**Del reporte ciudadano a la acción preventiva.**

Proyecto para el Reto 3 del hackathon, Agua y lluvia. Busca conectar a la ciudadanía, Protección Civil y organismos operadores de agua en Veracruz mediante reportes geolocalizados, seguimiento institucional e información preventiva.

## Estado

El proyecto está en el módulo de arranque. La aplicación, Firebase y las integraciones externas están pendientes de implementación. Esta entrega contiene la estructura inicial y la documentación.

## Estructura

| Ruta | Responsabilidad prevista |
| --- | --- |
| `web/` | Aplicación React con Vite. Contendrá la interfaz ciudadana, el mapa y los paneles institucionales. |
| `firebase/` | Reglas de Firestore y Storage, configuración de emuladores y funciones backend. |
| `docs/` | Bitácora de IA y futuras decisiones técnicas del proyecto. |

## Desarrollo por módulos

1. **Arranque.** Estructura, documentación y control de versiones.
2. **Reporte y seguimiento.** Autenticación, permisos por rol, captura de texto, foto opcional y ubicación, persistencia, mapa y actualización institucional de estado.
3. **Asistencia con IA.** Clasificación y gravedad sugeridas desde el backend, revisión humana y manejo de errores sin perder el reporte.
4. **Prevención por lluvia.** Consulta meteorológica, indicador experimental explicable y avisos emitidos por Protección Civil.
5. **Servicios complementarios.** Tandeos, guías y estadísticas según el tiempo disponible.

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
