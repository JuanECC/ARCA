# ARCA ante un corte de internet

## Alcance implementado

La versión compilada guarda los archivos de la aplicación mediante un service worker. La persona prepara previamente un dispositivo de confianza, conserva su sesión y descarga los datos. Firestore utiliza una caché persistente después de esa elección. El panel **Conexión y pendientes** muestra fecha de descarga, avisos, reportes y una guía breve consultable sin red.

Los reportes ciudadanos con foto se guardan primero en IndexedDB. Cada pendiente tiene un ID fijo y pertenece a la cuenta que lo creó. Al abrir ARCA con esa cuenta y recuperar conexión, una transacción comprueba el perfil actual y crea el reporte si todavía no existe. Un rechazo conserva el pendiente con su mensaje de error. La confirmación de envío aparece después de que Firebase acepta la transacción.

El reloj de guardado local indica cuándo se preparó el borrador. La fecha oficial de creación del reporte se asigna en Firebase al recibirlo.

## Preparación de la demo

Desde la raíz del repositorio:

```bash
npm run build
npm run preview --prefix web -- --host 127.0.0.1
```

Abrir la dirección de preview indicada por Vite. Para probar desde un teléfono se necesita un sitio HTTPS. El servidor de desarrollo de Vite no constituye la prueba de recarga sin red.

1. Iniciar sesión como ciudadano, completar el perfil y comprobar que los datos cargan.
2. Abrir **Conexión y pendientes → Preparar este dispositivo**. La primera vez se recarga para activar la persistencia.
3. Esperar el mensaje de preparación y la fecha de descarga. Esta acción necesita conexión, espacio disponible y permisos de almacenamiento del navegador.
4. En otra sesión de Protección Civil, preparar un aviso identificado como **SIMULACIÓN**. Utilizar el emulador o un proyecto de demostración para evitar mezclar el ejercicio con información operativa.
5. En el detalle del aviso publicado, abrir **Ficha de difusión durante cortes de internet**. La casilla de simulación está activada inicialmente. Descargar la ficha antes del corte.

## Secuencia ante el jurado

1. Mostrar el aviso descargado y la fecha de la última recepción.
2. Desactivar la red del dispositivo ciudadano. En un navegador de escritorio puede usarse Network → Offline, manteniendo conectado el dispositivo institucional.
3. Recargar ARCA. La aplicación abre con la sesión que ya estaba preparada.
4. Consultar **Avisos descargados**, **Reportes descargados** y la guía. Si las teselas del mapa no cargan, usar la lista de reportes.
5. Generar un reporte con una fotografía. Obtener ubicación mediante GPS si está disponible o introducir coordenadas conocidas. Se muestra **Guardado en este dispositivo**, pendiente de confirmación.
6. Recargar otra vez y mostrar que el pendiente y su foto siguen presentes.
7. Desde la sesión institucional conectada, publicar otro aviso de simulación. Mostrar que el dispositivo desconectado todavía no lo recibe.
8. Representar la lectura de la ficha por perifoneo o por personal autorizado. Identificarla como simulación. Descargar una ficha no acredita la entrega a la población.
9. Recuperar la red. Mostrar el aviso nuevo, la confirmación del reporte enviado y su aparición en el historial. Recargar y comprobar que existe un solo reporte.

## Qué llega durante el corte

- Los avisos ya descargados y sus recomendaciones permanecen disponibles con su fecha.
- Un aviso creado después del corte requiere otro canal para alcanzar la colonia. La ficha ayuda al personal autorizado a difundir el contenido por perifoneo o de manera presencial, según los medios realmente disponibles.
- Los SMS requerirían un proveedor, cobertura telefónica, consentimiento e integración adicional. No se enviaron SMS en esta demo.
- Las notificaciones push también necesitan conectividad para recibir información nueva. La demo utiliza avisos dentro de ARCA.

## Límites comprobables

- Hace falta una visita y preparación previas. Un dispositivo nuevo no puede descargar la app durante un corte total.
- El inicio de sesión y el registro de cuentas nuevas requieren conexión.
- El envío automático ocurre con ARCA abierta y conectada. No se depende de sincronización en segundo plano con el navegador cerrado.
- Los pendientes se conservan ante errores de red o rechazo de permisos. Se muestran solo a la cuenta que los creó.
- Borrar datos del navegador o usar almacenamiento efímero puede eliminar los pendientes y las descargas. Se permite un máximo de 20 pendientes por cuenta en el formulario.
- La caché puede ser desalojada por el navegador. La fecha de preparación no garantiza permanencia indefinida.
- Las teselas de OpenStreetMap y las fuentes externas no se descargan masivamente. La lista, coordenadas y textos proporcionan una alternativa al mapa.
- El clima guardado muestra fecha y fuente. Las alertas guardadas podrían haber cambiado de estado durante el corte.
- Las acciones institucionales dependen de Firebase. Esta entrega añade borradores sin conexión al flujo ciudadano.
- Una actualización del service worker se activa cuando se cierran las pestañas de la versión anterior. Para repetir la demo tras cambios de código, cerrar las pestañas de preview y abrir de nuevo.

## Texto para la entrega

Implementamos continuidad de consulta y captura durante cortes de internet. ARCA permite preparar el dispositivo con la aplicación, avisos, reportes y una guía. Durante el corte muestra la fecha de los datos guardados y conserva reportes con foto como pendientes locales. Al reconectar, valida la cuenta y sincroniza cada reporte con un identificador estable para evitar duplicados. Para una alerta nueva durante un corte total, incorporamos una ficha de difusión que el personal autorizado puede usar por canales locales. En la demostración, esta difusión se representa como simulación; no afirmamos que el teléfono reciba una alerta nueva sin un canal de comunicación.

## Fuentes

- [Persistencia sin conexión de Firestore](https://firebase.google.com/docs/firestore/manage-data/enable-offline).
- [Service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
- [Operación sin conexión y notificaciones push](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Offline_and_background_operation).
- [CENAPRED, En caso de inundación](https://www.gob.mx/cenapred/documentos/infografia-en-caso-de-inundacion), consultado el 12 de noviembre de 2026. El resumen incluido debe pasar por revisión institucional antes de una operación real.
