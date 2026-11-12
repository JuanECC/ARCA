// ARCA · Alertas por SMS con textbee (gratis: un celular Android manda los SMS con su propio plan).
// Cuando se publica un aviso de nivel alto o crítico en `notices`, manda un SMS a los
// ciudadanos del sector afectado que aceptaron alertas (usuarios.receiveAlerts).
// Funciona aunque el ciudadano no tenga luz ni internet: el SMS viaja por la red celular.
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineInt, defineSecret, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { users } from './accounts.js';

const db = getFirestore();

// Configuración (ver docs/alertas-sms.md)
const TEXTBEE_API_KEY = defineSecret('TEXTBEE_API_KEY');
const TEXTBEE_DEVICE_ID = defineString('TEXTBEE_DEVICE_ID', { default: 'auto' }); // 'auto' = el celular predeterminado
const SMS_MODE = defineString('SMS_MODE', { default: 'prueba' }); // apagado | prueba | real
const SMS_DAILY_LIMIT = defineInt('SMS_DAILY_LIMIT', { default: 50 }); // plan gratis de textbee: 50 al día, 300 al mes

const SMS_LEVELS = new Set(['alto', 'critico', 'urgente']);
const MAX_LENGTH = 160; // un solo SMS con caracteres GSM (sin acentos)
const BATCH = 20; // destinatarios por petición a textbee
const TEXTBEE_URL = 'https://api.textbee.dev/api/v1/gateway/send-sms';

// "2291234567" → "+522291234567". Devuelve null si no parece un celular de México.
export function toE164(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length === 10) return `+52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return `+${digits}`;
  if (digits.length === 13 && digits.startsWith('521')) return `+52${digits.slice(3)}`; // formato anterior con "1"
  return null;
}

// Sin acentos ni símbolos especiales: así cabe en 160 caracteres y cuesta un solo SMS
export function smsText({ title, message }) {
  const plain = (text) => String(text || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[¿¡]/g, '').replace(/[^\x20-\x7E]/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const full = `ARCA ALERTA: ${plain(title)}. ${plain(message)}`;
  return full.length <= MAX_LENGTH ? full : `${full.slice(0, MAX_LENGTH - 3).trimEnd()}...`;
}

// Ciudadanos que aceptaron alertas: los del sector del aviso, o todos si el aviso no tiene sector
async function recipientsFor(notice) {
  let query = users.where('role', '==', 'citizen').where('receiveAlerts', '==', true);
  if (notice.sectorId) query = query.where('sectorId', '==', notice.sectorId);
  const snapshot = await query.get();
  const phones = snapshot.docs.map((doc) => toE164(doc.get('phone'))).filter(Boolean);
  return [...new Set(phones)];
}

// Aparta cupo del límite diario; devuelve cuántos mensajes se pueden mandar
async function reserveQuota(wanted) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
  const ref = db.collection('smsDaily').doc(today);
  return db.runTransaction(async (t) => {
    const used = (await t.get(ref)).get('sent') || 0;
    const allowed = Math.max(0, Math.min(wanted, SMS_DAILY_LIMIT.value() - used));
    t.set(ref, { sent: used + allowed, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    return allowed;
  });
}

// Manda el SMS por tandas. textbee lo pone en cola y el celular lo envía con su plan.
async function sendAll(phones, body) {
  const device = TEXTBEE_DEVICE_ID.value();
  const result = { sent: 0, failed: 0, errors: [] };
  for (let i = 0; i < phones.length; i += BATCH) {
    const recipients = phones.slice(i, i + BATCH);
    try {
      const response = await fetch(TEXTBEE_URL, {
        method: 'POST',
        headers: { 'x-api-key': TEXTBEE_API_KEY.value(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipients, message: body, ...(device && device !== 'auto' ? { deviceId: device } : {}) }),
        signal: AbortSignal.timeout(15000),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.data?.success) throw new Error(`textbee ${response.status}: ${data.error || data.message || 'sin detalle'}`);
      result.sent += data.data.recipientCount ?? recipients.length;
    } catch (error) {
      result.failed += recipients.length;
      if (result.errors.length < 5) result.errors.push(error.message);
    }
  }
  return result;
}

export const sendSmsAlert = onDocumentCreated(
  {
    document: 'notices/{noticeId}',
    secrets: [TEXTBEE_API_KEY],
    timeoutSeconds: 300,
    maxInstances: 5,
  },
  async (event) => {
    const notice = event.data?.data();
    const mode = SMS_MODE.value();
    if (!notice || mode === 'apagado' || !SMS_LEVELS.has(notice.level)) return;

    // Un solo envío por aviso aunque la función se ejecute dos veces
    const log = db.collection('smsLog').doc(event.params.noticeId);
    try {
      await log.create({ status: 'enviando', mode, level: notice.level, sectorId: notice.sectorId || null, at: FieldValue.serverTimestamp() });
    } catch {
      logger.info('SMS ya procesado para este aviso', { noticeId: event.params.noticeId });
      return;
    }

    const body = smsText(notice);
    const phones = await recipientsFor(notice);

    if (mode !== 'real') {
      // Modo prueba: no se manda nada ni se cobra; solo queda el registro de lo que se habría enviado
      await log.update({ status: 'prueba', body, recipients: phones.length, sent: 0 });
      logger.info('SMS en modo prueba', { noticeId: event.params.noticeId, recipients: phones.length, body });
      return;
    }

    if ((TEXTBEE_API_KEY.value() || '').length < 10) {
      await log.update({ status: 'sin-configurar', body, recipients: phones.length, sent: 0 });
      logger.error('SMS_MODE=real pero falta la llave TEXTBEE_API_KEY');
      return;
    }

    const allowed = await reserveQuota(phones.length);
    const result = allowed ? await sendAll(phones.slice(0, allowed), body) : { sent: 0, failed: 0, errors: [] };
    const status = result.failed && !result.sent ? 'fallido'
      : result.failed ? 'parcial'
        : allowed < phones.length ? 'limite-diario' : 'enviado';
    await log.update({
      status,
      body,
      recipients: phones.length,
      skippedByLimit: phones.length - allowed,
      ...result,
    });
    logger.info('SMS enviados', { noticeId: event.params.noticeId, recipients: phones.length, ...result });
  },
);
