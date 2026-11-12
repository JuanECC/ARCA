// ARCA · Notificaciones push (Firebase Cloud Messaging). Gratis y sin servicios externos.
// Cuando se publica un aviso en `notices`, avisa a los celulares registrados en `pushTokens`:
// a todos si el aviso es para toda la ciudadanía, o solo a los del sector si es por sector.
// Llega aunque ARCA esté cerrada (necesita datos móviles o wifi en el celular).
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';
import './accounts.js'; // inicializa Firebase Admin

const db = getFirestore();
const CHUNK = 500; // máximo de celulares por envío de FCM
const STALE = new Set(['messaging/registration-token-not-registered', 'messaging/invalid-registration-token']);

// Contenido de la notificación (FCM solo acepta textos en `data`)
export function pushPayload(notice, noticeId) {
  const clip = (text, max) => {
    const value = String(text || '').trim();
    return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`;
  };
  return {
    title: clip(notice.title || 'Aviso de ARCA', 80),
    body: clip(notice.message, 240),
    level: String(notice.level || 'info'),
    tag: `aviso-${noticeId}`,
    url: '/',
  };
}

async function tokensFor(notice) {
  let query = db.collection('pushTokens');
  if (notice.audience !== 'todos' && notice.sectorId) query = query.where('sectorId', '==', notice.sectorId);
  return (await query.get()).docs.map((doc) => doc.id);
}

export const sendPushAlert = onDocumentCreated(
  { document: 'notices/{noticeId}', timeoutSeconds: 120, maxInstances: 5 },
  async (event) => {
    const notice = event.data?.data();
    const { noticeId } = event.params;
    if (!notice) return;

    // Un solo envío por aviso aunque la función se ejecute dos veces
    const log = db.collection('pushLog').doc(noticeId);
    try {
      await log.create({ status: 'enviando', at: FieldValue.serverTimestamp() });
    } catch {
      return;
    }

    const tokens = await tokensFor(notice);
    const data = pushPayload(notice, noticeId);
    let sent = 0;
    let failed = 0;
    const stale = [];

    for (let i = 0; i < tokens.length; i += CHUNK) {
      const chunk = tokens.slice(i, i + CHUNK);
      const result = await getMessaging().sendEachForMulticast({
        tokens: chunk,
        data,
        webpush: { headers: { Urgency: 'high', TTL: '86400' } }, // si el celular está apagado, se entrega al prenderlo (hasta 24 h)
      });
      result.responses.forEach((response, index) => {
        if (response.success) sent += 1;
        else {
          failed += 1;
          if (STALE.has(response.error?.code)) stale.push(chunk[index]);
        }
      });
    }

    // Borra los celulares que ya no existen (desinstalaron o quitaron el permiso)
    for (let i = 0; i < stale.length; i += CHUNK) {
      const batch = db.batch();
      stale.slice(i, i + CHUNK).forEach((token) => batch.delete(db.collection('pushTokens').doc(token)));
      await batch.commit();
    }

    await log.update({ status: 'enviado', tokens: tokens.length, sent, failed, removed: stale.length });
    logger.info('Notificaciones push enviadas', { noticeId, tokens: tokens.length, sent, failed, removed: stale.length });
  },
);
