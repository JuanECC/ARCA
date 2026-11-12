# Notificaciones push (Firebase Cloud Messaging)

Cuando se publica un aviso en `notices`, ARCA manda una notificación al celular de la ciudadanía:
**suena y aparece aunque ARCA esté cerrada**. Es gratis y usa el mismo proyecto de Firebase (sin registros nuevos).
Necesita datos móviles o wifi en el celular; para avisar sin internet está el SMS (`docs/alertas-sms.md`).

| Parte | Archivo | Qué hace |
|---|---|---|
| Activar en el celular | `web/src/modules/notifications/pushService.js` | Pide el permiso, registra el celular en FCM y guarda su token en `pushTokens/{token}` con el sector del usuario. |
| Botón | `NotificationBell.jsx` | En la lista de la campana: **"Recibe las alertas aunque ARCA esté cerrada → Activar"**. Si ya dio permiso, el celular se vuelve a registrar solo al entrar (mantiene el sector al día). |
| Mostrar la notificación | `web/public/push-sw.js` | Service worker propio con alcance `/push/`: no se mezcla con el de modo sin conexión (`sw.js`). Al tocar la notificación abre ARCA. Las alertas críticas se quedan en pantalla. |
| Enviar | `firebase/functions/push.js` (`sendPushAlert`) | Al crearse un aviso: si es para toda la ciudadanía (`audience: 'todos'`) avisa a todos los celulares; si es por sector, solo a los de ese sector. Borra solos los celulares que ya no existen y registra el envío en `pushLog/{idDelAviso}` (una sola vez por aviso). |
| Seguridad | `firebase/rules/firestore.rules` (`pushTokens`) | Cada usuario solo registra su propio celular, con campos fijos y la hora del servidor. Nadie puede leer ni listar los tokens desde la app. |

## Cómo activarlo

1. **Llave web (VAPID):** consola de Firebase → *Configuración del proyecto* → *Cloud Messaging* →
   *Certificados web push* → **Generar par de claves**. Copiar la llave.
2. **Número del remitente:** en esa misma pantalla, *ID del remitente* (Sender ID).
3. Agregar a `web/.env.local`:
   ```dotenv
   VITE_FIREBASE_MESSAGING_SENDER_ID=123456789012
   VITE_FIREBASE_VAPID_KEY=BExxxxxxxx...
   ```
4. Publicar las reglas y desplegar la función:
   ```bash
   firebase deploy --only firestore:rules,functions --project arca-e7c40
   ```
5. Abrir ARCA en el celular (con HTTPS, o `localhost` en pruebas), tocar la campana → **Activar** → **Permitir**.
6. Publicar un aviso desde Operaciones o Protección Civil: la notificación llega aunque ARCA esté cerrada.

## Notas

- **Android:** funciona en Chrome con ARCA instalada o no.
- **iPhone:** solo si ARCA está **instalada en la pantalla de inicio** (Compartir → *Agregar a pantalla de inicio*), iOS 16.4 o más nuevo.
- Si el celular está apagado o sin señal, FCM guarda el aviso hasta 24 horas y lo entrega al reconectarse.
- Si el usuario bloquea las notificaciones, la campana le explica cómo volver a activarlas en el navegador.
- Sin `VITE_FIREBASE_VAPID_KEY` el botón no aparece y todo lo demás funciona igual.
