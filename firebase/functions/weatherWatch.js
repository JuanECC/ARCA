// ARCA · Vigilancia del clima. Cada 30 minutos revisa el pronóstico de Open-Meteo para
// Veracruz – Boca del Río. Si viene lluvia intensa o viento fuerte, NO manda SMS directo:
// crea un borrador de alerta en el panel de Protección Civil. Cuando una persona lo revisa
// y lo publica, la función sendSmsAlert manda los SMS. Así un pronóstico no se confunde
// con una medición oficial.
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineInt, defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';
import { users } from './accounts.js';

const db = getFirestore();

// Cuenta de Protección Civil dueña de los borradores: las reglas solo dejan publicar
// una alerta a quien la creó. Con 'auto' se usa la primera cuenta de PC.
const WEATHER_ALERT_OWNER_UID = defineString('WEATHER_ALERT_OWNER_UID', { default: 'auto' });
const RAIN_3H_MM = defineInt('WEATHER_RAIN_3H_MM', { default: 30 }); // lluvia acumulada en 3 h
const RAIN_CRITICAL_3H_MM = defineInt('WEATHER_RAIN_CRITICAL_3H_MM', { default: 60 });
const GUSTS_KMH = defineInt('WEATHER_GUSTS_KMH', { default: 70 }); // ráfagas de viento

const CITY = { lat: 19.17, lng: -96.13 }; // el mismo punto que usa el clima de la app ciudadana
const FORECAST_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${CITY.lat}&longitude=${CITY.lng}` +
  '&hourly=precipitation,precipitation_probability,wind_gusts_10m&forecast_hours=6&timezone=America/Mexico_City';

// Revisa las próximas horas y devuelve los eventos que pasan los límites
export function detectEvents(hourly, limits) {
  const rain = hourly.precipitation ?? [];
  const gusts = hourly.wind_gusts_10m ?? [];
  const events = [];
  let rain3h = 0;
  for (let i = 0; i + 3 <= rain.length; i += 1) {
    rain3h = Math.max(rain3h, rain.slice(i, i + 3).reduce((a, b) => a + (b || 0), 0));
  }
  if (rain3h >= limits.rain3h) {
    events.push({
      id: 'lluvia',
      type: 'inundacion',
      level: rain3h >= limits.rainCritical3h ? 'critico' : 'alto',
      description: `Pronóstico: lluvia intensa de hasta ${Math.round(rain3h)} mm en 3 horas. Riesgo de encharcamientos e inundaciones. Revisa y confirma antes de publicar.`,
    });
  }
  const maxGust = Math.max(0, ...gusts.filter(Number.isFinite));
  if (maxGust >= limits.gusts) {
    events.push({
      id: 'viento',
      type: 'riesgo-otro',
      level: 'alto',
      description: `Pronóstico: ráfagas de viento de hasta ${Math.round(maxGust)} km/h. Riesgo de caída de árboles, cables y anuncios. Revisa y confirma antes de publicar.`,
    });
  }
  return events;
}

async function alertOwner() {
  const configured = WEATHER_ALERT_OWNER_UID.value();
  if (configured && configured !== 'auto') return configured;
  const pc = await users.where('role', '==', 'civil-protection').limit(1).get();
  return pc.empty ? null : pc.docs[0].id;
}

export const watchWeather = onSchedule(
  { schedule: 'every 30 minutes', timeZone: 'America/Mexico_City', timeoutSeconds: 120 },
  async () => {
    let forecast;
    try {
      const response = await fetch(FORECAST_URL, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) throw new Error(`Open-Meteo respondió ${response.status}`);
      forecast = await response.json();
    } catch (error) {
      logger.warn('No se pudo consultar el pronóstico', { error: error.message });
      return;
    }

    const events = detectEvents(forecast.hourly ?? {}, {
      rain3h: RAIN_3H_MM.value(),
      rainCritical3h: RAIN_CRITICAL_3H_MM.value(),
      gusts: GUSTS_KMH.value(),
    });
    if (!events.length) return;

    const owner = await alertOwner();
    if (!owner) {
      logger.warn('Hay pronóstico de riesgo pero no existe una cuenta de Protección Civil para revisarlo', { events });
      return;
    }

    // Un borrador por sector activo y por evento, máximo uno al día (el id evita repetirlos)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });
    const sectors = await db.collection('sectors').where('active', '==', true).get();
    let created = 0;
    for (const sector of sectors.docs) {
      for (const event of events) {
        try {
          await db.collection('systemReports').doc(`clima_${today}_${event.id}_${sector.id}`).create({
            source: 'proteccion-civil',
            status: 'nuevo',
            type: event.type,
            level: event.level,
            sectorId: sector.id,
            colonia: String(sector.get('name') || 'Sector').slice(0, 100),
            description: event.description,
            position: CITY,
            reporter: 'Pronóstico automático (Open-Meteo)',
            photos: [],
            createdBy: owner,
            creadoEn: FieldValue.serverTimestamp(),
          });
          created += 1;
        } catch (error) {
          if (error.code !== 6) throw error; // 6 = ya existe: ese borrador ya se creó hoy
        }
      }
    }
    if (created) logger.info('Borradores de alerta por clima creados', { created, events: events.map((e) => e.id) });
  },
);
