# Alertas por SMS (textbee) y vigilancia del clima

Cuando se publica un aviso **alto o crítico**, ARCA manda un SMS a los ciudadanos del sector afectado que
marcaron **"Recibir alertas urgentes"** en su perfil. El SMS llega por la red celular: funciona aunque el
ciudadano no tenga luz, wifi ni datos.

Los SMS se mandan con **[textbee](https://textbee.dev)**: un celular Android con SIM se vuelve la "antena" de
ARCA y envía los mensajes con su propio plan. Es gratis: **50 SMS al día y 300 al mes** con un celular.
(Las APIs gratuitas tipo Textbelt tienen bloqueado México.)

| Función | Archivo | Qué hace |
|---|---|---|
| `sendSmsAlert` | `firebase/functions/sms.js` | Se activa al crearse un documento en `notices`. Si el nivel es `alto`, `critico` o `urgente`, busca en `usuarios` a los ciudadanos con `receiveAlerts = true` del `sectorId` del aviso (o a todos si no tiene sector) y les manda el SMS por textbee. |
| `watchWeather` | `firebase/functions/weatherWatch.js` | Cada 30 min revisa Open-Meteo. Si viene lluvia intensa o viento fuerte, **no manda SMS**: crea un borrador "por publicar" en el panel de Protección Civil (uno por sector activo, máximo uno al día por evento). Al publicarlo, `sendSmsAlert` manda los SMS. |

## Controles

- **Un solo envío por aviso:** se registra en `smsLog/{idDelAviso}` con el estado (`prueba`, `enviado`,
  `limite-diario`, `parcial`, `fallido` o `sin-configurar`), el mensaje y cuántos se enviaron. No guarda teléfonos.
- **Límite diario:** `smsDaily/{fecha}` cuenta los SMS del día; al llegar a `SMS_DAILY_LIMIT` deja de enviar.
- **Modo prueba (predeterminado):** no llama a textbee; solo registra en `smsLog` lo que habría enviado.
- **Mensaje:** sin acentos y de máximo 160 caracteres (un solo SMS). Ejemplo:
  `ARCA ALERTA: Fuga de gas en Sector Centro 2. Evita la zona y sigue las indicaciones de Proteccion Civil.`
- **Teléfono:** se convierte a formato internacional de México (`2291234567` → `+522291234567`).
- **Darse de baja:** el ciudadano desmarca la casilla en su perfil.

## Configuración

Parámetros (archivo `firebase/functions/.env`, no se sube a GitHub):

| Parámetro | Predeterminado | Para qué |
|---|---|---|
| `SMS_MODE` | `prueba` | `apagado`, `prueba` (no envía) o `real` (envía con textbee). |
| `TEXTBEE_DEVICE_ID` | `auto` | ID del celular en textbee; `auto` usa el celular predeterminado de la cuenta. |
| `SMS_DAILY_LIMIT` | `50` | Máximo de SMS por día (el plan gratis permite 50 al día y 300 al mes). |
| `WEATHER_ALERT_OWNER_UID` | `auto` (primera cuenta de PC) | Cuenta de Protección Civil que revisa y publica los borradores del clima. Las reglas solo dejan publicar una alerta a quien la creó. |
| `WEATHER_RAIN_3H_MM` | `30` | Lluvia acumulada en 3 h para sugerir alerta (nivel alto). |
| `WEATHER_RAIN_CRITICAL_3H_MM` | `60` | Lluvia en 3 h para nivel crítico. |
| `WEATHER_GUSTS_KMH` | `70` | Ráfagas de viento para sugerir alerta. |

Secreto (se guarda en Google Secret Manager, nunca en el código):

```bash
firebase functions:secrets:set TEXTBEE_API_KEY
```

## Cómo activarlo

1. **Celular:** un Android con SIM (de preferencia con SMS ilimitados en su plan) y, de preferencia, conectado
   a la corriente. Instalar la app de textbee desde [textbee.dev](https://textbee.dev) y dar permiso de SMS
   (en Android 15 o más nuevo, primero "Permitir configuración restringida").
2. **Cuenta:** entrar a `app.textbee.dev/dashboard`, **Generate API Key** (se muestra una sola vez) y registrar el
   celular con el código QR. Copiar el **Device ID** si se quiere fijar el celular.
3. **Probar la llave** desde la terminal (manda un SMS de verdad a tu número):
   ```bash
   curl -X POST https://api.textbee.dev/api/v1/gateway/send-sms \
     -H "x-api-key: TU_LLAVE" -H "Content-Type: application/json" \
     -d '{"recipients": ["+52XXXXXXXXXX"], "message": "ARCA ALERTA: prueba de SMS"}'
   ```
4. **Firebase:** el proyecto debe estar en el plan **Blaze** para que las funciones puedan llamar a textbee
   (pongan una alerta de presupuesto; las funciones de este uso caben en la capa gratuita).
5. **Guardar la llave** (`firebase functions:secrets:set TEXTBEE_API_KEY`) y crear `firebase/functions/.env`:
   ```dotenv
   SMS_MODE=prueba
   SMS_DAILY_LIMIT=50
   ```
6. **Desplegar:** `firebase deploy --only functions --project arca-e7c40`.
7. **Probar:** publicar una alerta alta o crítica y revisar `smsLog` en Firestore.
8. **Activar:** cambiar a `SMS_MODE=real` y volver a desplegar.

## Notas

- Los SMS salen del número del celular registrado, con su plan. Las reglas de uso justo del operador aplican.
- Si el celular de textbee se queda sin batería o sin señal, los mensajes esperan en la cola de textbee.
- Los avisos de Operaciones se publican con nivel `info`, así que hoy no mandan SMS; solo las alertas de
  Protección Civil de nivel alto o crítico.
- Los borradores del clima usan el centro de Veracruz – Boca del Río como ubicación, porque los sectores no
  tienen coordenadas propias.
- La región de las funciones debe ser compatible con la ubicación de la base de datos de Firestore.
- Para más volumen, el plan Pro de textbee permite 5,000 SMS al mes y hasta 5 celulares.
