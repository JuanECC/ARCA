/*
 * HidroAlerta ARCA · Dashboard y Mapa de Riesgos (público: ciudadanía)
 * Todo el módulo en un solo archivo. Sus estilos están en HidroAlertaDashboard.css
 * y quedan encerrados en la clase .ha, así no chocan con el resto del proyecto.
 *
 * Requiere:  npm install leaflet react-leaflet   (React 18: react-leaflet@4.2.1)
 *
 * Uso:
 *   import HidroAlertaDashboard from './HidroAlertaDashboard';
 *   <HidroAlertaDashboard />
 *
 * Props opcionales (para conectar después la base de datos):
 *   colonias, fugas, drenajes, evidencias  → listas con la misma forma que los datos de ejemplo
 *   onShareAlert(alerta)                    → se llama al pulsar "Compartir alerta"
 */
import { useEffect, useState } from 'react';
import { CircleMarker, MapContainer, TileLayer, Popup, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { auth } from '../auth/firebase';
import CitizenProfile from './CitizenProfile';
import { isCitizenProfileComplete, saveCitizenProfile, subscribeCitizenProfile } from './profileService';
import { REPORT_TYPES, subscribeReports, createCitizenReport, getCurrentLocation } from './reportsService';
import 'leaflet/dist/leaflet.css';
import './CitizenReports.css';

/* =========================================================================
 * 1. DATOS DE EJEMPLO (se reemplazan por los de la base de datos)
 * ========================================================================= */

// Semáforo hídrico: nivel → texto y color
const RISK = {
  low: { label: 'Bajo', tone: 'success', legend: 'Verde: normal (< 10 cm)' },
  mid: { label: 'Medio', tone: 'warning', legend: 'Amarillo: moderado (10 – 30 cm)' },
  high: { label: 'Alto', tone: 'error', legend: 'Rojo: crítico (> 30 cm)' },
};

const MAP_CENTER = [19.176, -96.138];

// Coordenadas aproximadas
const COLONIAS = [
  { id: 'floresta', name: 'Col. Floresta', position: [19.1585, -96.1255], level: 'high', summary: '3 reportes validados · 40 – 45 cm', advice: 'Evitar vehículos bajos' },
  { id: 'chiveria', name: 'Col. Chivería', position: [19.1705, -96.1505], level: 'mid', summary: 'Encharcamiento preventivo en cruces', advice: 'Tránsito lento' },
  { id: 'brisas', name: 'Col. Las Brisas', position: [19.1845, -96.1585], level: 'mid', summary: 'Alcantarillas al 80 %', advice: 'Cuidado en rejillas' },
  { id: 'reforma', name: 'Col. Reforma', position: [19.1835, -96.1295], level: 'low', summary: 'Circulación libre', advice: 'Fluido' },
  { id: 'centro', name: 'Centro Histórico', position: [19.1985, -96.1365], level: 'low', summary: 'Drenaje al malecón despejado', advice: 'Normal' },
  { id: 'zaragoza', name: 'Col. Zaragoza', position: [19.1905, -96.1435], level: 'low', summary: 'Sin incidencias en 6 h', advice: 'Normal' },
];

const FUGAS = [
  { id: 'pocitos', name: 'Pocitos y Rivera', position: [19.1765, -96.1405], detail: 'Fuga en red de 12"' },
  { id: 'virginia', name: 'Col. Virginia', position: [19.1495, -96.1065], detail: 'Fuga de ½" · ~35 L/min' },
];

const DRENAJES = [
  { id: 'd1', name: 'Rejilla Av. Ejército Mexicano', position: [19.1615, -96.1295], detail: 'Obstrucción 80 %' },
  { id: 'd2', name: 'Colector Díaz Mirón', position: [19.1765, -96.1335], detail: 'Operando al 65 %' },
];

// Pronóstico de respaldo si Open-Meteo no responde
const FORECAST = [
  { hour: '16 h', probability: 35 },
  { hour: '17 h', probability: 68 },
  { hour: '18 h', probability: 92 },
  { hour: '19 h', probability: 75 },
  { hour: '20 h', probability: 45 },
  { hour: '21 h', probability: 22 },
];

// Fotos de referencia. Si no cargan se ve un degradado.
const IMG = 'https://lh3.googleusercontent.com/aida-public/';
const EVIDENCIAS = [
  {
    id: 'e1', tone: 'error', place: 'Col. Floresta · 40–45 cm', street: 'Av. Paseo de los Sauces', time: '17:15', ai: 'Validación 98 % inundación',
    image: IMG + 'AB6AXuAWh6oUl1ElzcFhIvWnY5nULijmGHEX3fHgw9BGBU-P1FTpB-76Tp7mDTdDyxAXEL3M7oyfCy54kMIo8q_Rn9w6TqovXXivbig8QK725KkDH7-xTqfGPf4L-QdBVcnF-NsjTlHzX1pM4h9BUHf1Y16cUYFS3QG00B3-7eV_dgxEfcmHrj8nhsLrCUbMJe33HQoadXyB9ny73PH2Aeou10uAs1ukukKWgsUVRsgVEg',
  },
  {
    id: 'e2', tone: 'warning', place: 'Col. Las Brisas · 20 cm', street: 'Av. Víctor Sánchez Tapia', time: '16:48', ai: 'Rejilla pluvial colapsada',
    image: IMG + 'AB6AXuBLifAiafPZ3IgzDiwqa4V8-CBTeEDVrANQV_E2VXEL4LtitH4ACEtWffeUXpC96WDImm3Tb7VUYcqvfEB38JApIGj_biCT6PB1_FoKR7e8H9m_dU1Ro_2KsADTyhMSGXrOs9e7ZT8hTFmdlPdeBG8W6O-1oMUwEhpUC9nvfV2VNMP0LYAzDOsLwBHPvZ5eMsNjws0MvM7EuTCu77ZzNrJ4YVWIg4o0Sw5LJ3XFJA',
  },
  {
    id: 'e3', tone: 'success', place: 'Boca del Río · despejado', street: 'Blvd. Ruiz Cortines', time: '17:02', ai: 'Flujo vehicular continuo',
    image: IMG + 'AB6AXuDxZJ9aZx7dJdoir6s_pAUoZJ1UaMy_DmMZOeaOn_2odfUMGRXOAojXB_4H79xGx2e247wG2xNAWvwmCtuZC4tI-DhBTwYOw-JQ5EokuPBJObve4z1O16joZpap2FUBWUfNB1CxawmwIfdWo_RpKjwjOck7Z9aJPPOI9zZtDF1wEnMik-uQ8-hc9Ebtv_-G8jN0GiJR2RUid7YHmvgsL3NQ5Rxuysehp4gpM5e0yg',
  },
];

/* =========================================================================
 * 2. UTILIDADES: tema, clima y notificaciones
 * ========================================================================= */

// Tema guardado o el del sistema operativo
function initialTheme() {
  try {
    const saved = localStorage.getItem('arca-theme');
    if (saved) return saved;
  } catch {
    /* navegador sin almacenamiento */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    try {
      localStorage.setItem('arca-theme', theme);
    } catch {
      /* sin almacenamiento: solo dura la sesión */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

// Clima real de Veracruz desde Open-Meteo (gratis, sin llave)
const WEATHER_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=19.17&longitude=-96.13' +
  '&current=temperature_2m,precipitation&hourly=precipitation_probability' +
  '&forecast_hours=6&timezone=America/Mexico_City';

function useWeather() {
  const [weather, setWeather] = useState({ temperature: '—', rain: '—', hourly: [] });

  useEffect(() => {
    fetch(WEATHER_URL)
      .then((res) => res.json())
      .then((data) =>
        setWeather({
          temperature: Math.round(data.current.temperature_2m),
          rain: data.current.precipitation,
          hourly: data.hourly.time.map((time, i) => ({
            hour: `${new Date(time).getHours()} h`,
            probability: data.hourly.precipitation_probability[i],
          })),
        }),
      )
      .catch(() => {}); // sin conexión: se quedan los valores de respaldo
  }, []);

  return weather;
}

// Notificaciones flotantes: nunca empujan la página
function useToasts() {
  const [toasts, setToasts] = useState([]);
  const dismiss = (id) => setToasts((list) => list.filter((t) => t.id !== id));
  const notify = (toast) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, tone: 'primary', icon: 'info', ...toast }].slice(-3));
    setTimeout(() => dismiss(id), 4500);
  };
  return { toasts, notify, dismiss };
}

// Quita acentos para buscar "chiveria" y encontrar "Chivería"
const clean = (text) => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* =========================================================================
 * 3. PIEZAS BÁSICAS
 * ========================================================================= */

// Ícono de Google Material Symbols. Ej: <Icon name="map" />
function Icon({ name, size = 20, className = '' }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={{ fontSize: size }} aria-hidden="true">
      {name}
    </span>
  );
}

// Etiqueta de color. tone: primary | secondary | tertiary | success | warning | error | neutral
function Badge({ tone = 'neutral', live = false, children }) {
  return (
    <span className={`ha-badge ha-tone-${tone}`}>
      {live && <span className="ha-live-dot" />}
      {children}
    </span>
  );
}

// Tarjeta con título opcional
function Card({ icon, title, aside, children }) {
  return (
    <section className="ha-card">
      <header className="ha-card__header">
        <h3 className="ha-card__title">
          <Icon name={icon} />
          {title}
        </h3>
        {aside}
      </header>
      {children}
    </section>
  );
}

function Logo() {
  return (
    <svg width="38" height="38" viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#006686" />
      <path d="M32 12c-7 10-14 18-14 26a14 14 0 0 0 28 0c0-8-7-16-14-26z" fill="#7dd3fc" />
      <path d="M14 44c6 4 12 4 18 0s12-4 18 0" stroke="#fff" strokeWidth="3.5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/* =========================================================================
 * 4. SECCIONES DEL DASHBOARD
 * ========================================================================= */

// Barra superior: marca, clima actual, 911 y botón de tema
function Header({ weather, theme, onToggleTheme, onLogout, onOpenProfile, profilePhoto }) {
  return (
    <header className="ha-header">
      <div className="ha-header__brand">
        <Logo />
        <div>
          <p className="ha-header__name">
            HidroAlerta <strong>ARCA</strong>
          </p>
          <p className="ha-header__tagline">Veracruz · Boca del Río</p>
        </div>
        <Badge tone="primary" live>
          Tiempo real
        </Badge>
      </div>

      <div className="ha-header__tools">
        <div className="ha-header__weather ha-num">
          <span className="ha-header__temp">{weather.temperature}°C</span>
          <span>Lluvia {weather.rain} mm/h</span>
        </div>
        <a className="ha-header__emergency" href="tel:911">
          <Icon name="emergency" size={16} /> 911
        </a>
        <button className="ha-header__theme" onClick={onToggleTheme} aria-label="Cambiar tema">
          <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
        </button>
        <button type="button" className="ha-header__profile" onClick={onOpenProfile} aria-label="Abrir mi perfil" title="Mi perfil">
          {profilePhoto ? <img src={profilePhoto} alt="" /> : <Icon name="account_circle" size={21}/>}<span>Mi perfil</span>
        </button>
        {onLogout && <button type="button" className="ha-header__logout" onClick={onLogout} aria-label="Cerrar sesión"><Icon name="logout" size={18}/><span>Salir</span></button>}
      </div>
    </header>
  );
}

// Las 4 tarjetas de indicadores
function KpiCards({ colonias, reports }) {
  const watched = reports.filter((r) => r.estado !== 'resuelto');
  const pending = reports.filter((r) => r.estado === 'pendiente').length;
  const reviewing = reports.filter((r) => r.estado === 'en-revision').length;
  const resolved = reports.filter((r) => r.estado === 'resuelto').length;

  return (
    <div className="ha-kpis">
      <article className="ha-kpi ha-tone-warning">
        <header className="ha-kpi__head">
          <span className="ha-label">Reportes registrados</span>
          <Icon name="traffic" className="ha-text-tone" />
        </header>
        <p className="ha-kpi__value">{reports.length}</p>
        <div className="ha-kpi__bar">
          <span style={{ width: `${reports.length ? (resolved / reports.length) * 100 : 0}%` }} />
        </div>
        <p className="ha-soft">Proporción de reportes resueltos</p>
      </article>

      <article className="ha-kpi ha-tone-primary">
        <header className="ha-kpi__head">
          <span className="ha-label">Reportes pendientes</span>
          <Icon name="rainy" className="ha-text-tone" />
        </header>
        <p className="ha-kpi__value ha-num">
          {pending} <small>sin atender</small>
        </p>
        <svg className="ha-kpi__line" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,20 Q15,18 25,14 T50,16 T75,8 T100,2" />
        </svg>
        <p className="ha-soft">Pendientes de revisión por las autoridades</p>
      </article>

      <article className="ha-kpi ha-tone-error">
        <header className="ha-kpi__head">
          <span className="ha-label">Reportes en seguimiento</span>
          <Icon name="warning" className="ha-text-tone" />
        </header>
        <p className="ha-kpi__value ha-num">
          {reviewing} <small>en revisión</small>
        </p>
        <div className="ha-kpi__tags">
          <Badge tone="warning">{watched.length} sin resolver</Badge>
        </div>
      </article>

      <article className="ha-kpi ha-tone-secondary">
        <header className="ha-kpi__head">
          <span className="ha-label">Reportes resueltos</span>
          <Icon name="waves" className="ha-text-tone" />
        </header>
        <p className="ha-kpi__value ha-num">
          {resolved} <small>resueltos</small>
        </p>
        <div className="ha-kpi__bar">
          <span style={{ width: `${reports.length ? (resolved / reports.length) * 100 : 0}%` }} />
        </div>
        <p className="ha-soft">Total de incidencias atendidas</p>
      </article>
    </div>
  );
}

const LAYERS = [
  { id: 'risk', label: 'Riesgos' },
  { id: 'leaks', label: 'Fugas' },
  { id: 'drains', label: 'Drenaje' },
  { id: 'reports', label: 'Todos' },
];

// Mueve el mapa hacia la colonia seleccionada
function FlyTo({ colonia }) {
  const map = useMap();
  useEffect(() => {
    if (colonia) map.flyTo(colonia.position, 15, { duration: 0.8 });
  }, [colonia, map]);
  return null;
}

function RiskMap({ theme, colonias, fugas, drenajes, reports, focus, onSelect }) {
  const [layer, setLayer] = useState('reports');

  // Las capas se alimentan de los reportes reales, no de arreglos vacíos.
  const categoryReports = reports.filter((r) => {
    if (layer === 'reports') return true;
    if (layer === 'leaks') return r.tipo === 'fuga';
    if (layer === 'drains') return r.tipo === 'drenaje';
    return ['inundacion', 'encharcamiento'].includes(r.tipo);
  });
  const points = categoryReports
    .filter(r => Number.isFinite(r.ubicacion?.lat) && Number.isFinite(r.ubicacion?.lng))
    .map(r => ({
      id: r.id, name: r.titulo,
      position: [r.ubicacion.lat, r.ubicacion.lng],
      detail: r.descripcion,
      tone: r.estado === 'resuelto' ? 'success' : r.tipo === 'inundacion' ? 'error' : 'warning',
      report: r,
    }));

  return (
    <Card icon="map" title="Mapa de riesgos">
      <div className="ha-map__layers">
        {LAYERS.map((l) => (
          <button key={l.id} className={layer === l.id ? 'is-active' : ''} onClick={() => setLayer(l.id)}>
            {l.label}
          </button>
        ))}
      </div>

      <p className="ha-soft ha-layer-count">{categoryReports.length} incidencia(s) en esta categoría</p>
      <div className={`ha-map ha-map--${theme}`}>

        <MapContainer center={MAP_CENTER} zoom={13} scrollWheelZoom={false} className="ha-map__canvas">
          <TileLayer
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <FlyTo colonia={focus} />
          {points.map((p) => (
            <CircleMarker
              key={p.id}
              center={p.position}
              radius={10}
              className={`ha-map__point ha-tone-${p.tone}`}
              eventHandlers={{ click: () => p.colonia && onSelect(p.colonia) }}
            >
              <Tooltip direction="top">
                <strong>{p.name}</strong>
                <br />
                {p.detail}
              </Tooltip>
              {p.report && <Popup minWidth={220}>
                <div className="ha-report-popup">
                  <strong>{p.report.titulo}</strong>
                  <p>{p.report.descripcion}</p>
                  <p>Reportado por: {p.report.autorNombre || 'Ciudadano (reporte anterior)'}</p>
                  <p>Tipo: {REPORT_TYPES.find(t => t.value === p.report.tipo)?.label || p.report.tipo}</p>
                  <p>Estado: {p.report.estado} · Precisión: ±{p.report.precisionMetros} m</p>
                  <p>Fecha: {p.report.creadoEn?.toDate?.().toLocaleString('es-MX') || 'Reciente'}</p>
                  {p.report.fotoBase64 && <img src={p.report.fotoBase64} alt="Evidencia del reporte" style={{width:'100%',maxHeight:160,objectFit:'cover'}} />}
                </div>
              </Popup>}
            </CircleMarker>
          ))}
        </MapContainer>

        <div className="ha-map__legend">
          <span className="ha-label">Semáforo hídrico</span>
          {Object.values(RISK).map((r) => (
            <span key={r.tone} className={`ha-tone-${r.tone}`}>
              <i /> {r.legend}
            </span>
          ))}
        </div>
      </div>
    </Card>
  );
}

// Fotos enviadas por la ciudadanía y validadas por IA
function Evidence({ evidencias }) {
  return (
    <Card icon="photo_camera" title="Evidencias ciudadanas" aside={<span className="ha-soft">Reportes recibidos</span>}>
      <div className="ha-evidence">
        {evidencias.length === 0 && <p className="ha-soft">Todavía no hay fotografías de reportes.</p>}
        {evidencias.map((e) => (
          <article key={e.id} className={`ha-evidence__item ha-tone-${e.tone}`}>
            <div className="ha-evidence__photo" style={{ backgroundImage: `url(${e.image})` }} />
            <div className="ha-evidence__body">
              <strong className="ha-text-tone">{e.place}</strong>
              <p>{e.street}</p>
              <p className="ha-evidence__ai">
                <Icon name="verified" size={14} /> {e.ai} · {e.time} h
              </p>
            </div>
          </article>
        ))}
      </div>
    </Card>
  );
}

// Lista del semáforo por colonia con buscador
function ColoniaList({ colonias, onSelect }) {
  const [query, setQuery] = useState('');
  const results = colonias.filter((c) => clean(c.name).includes(clean(query)));

  return (
    <Card icon="location_city" title="Semáforo por colonia">
      <label className="ha-search">
        <Icon name="search" size={18} />
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar colonia…" />
      </label>

      <ul className="ha-colonias">
        {results.map((c) => {
          const risk = RISK[c.level];
          return (
            <li key={c.id}>
              <button className={`ha-colonia ha-tone-${risk.tone}`} onClick={() => onSelect(c)}>
                <span className="ha-colonia__head">
                  <strong>{c.name}</strong>
                  <Badge tone={risk.tone}>{risk.label}</Badge>
                </span>
                <span className="ha-colonia__summary ha-text-tone">{c.summary}</span>
                <span className="ha-colonia__advice ha-soft">{c.advice}</span>
              </button>
            </li>
          );
        })}
        {results.length === 0 && <li className="ha-soft">No se encontró esa colonia.</li>}
      </ul>
    </Card>
  );
}

// Color de la barra según la probabilidad de lluvia
const toneFor = (p) => (p >= 80 ? 'error' : p >= 55 ? 'warning' : 'primary');

// Probabilidad de lluvia en las próximas 6 horas
function Forecast({ hourly }) {
  const live = hourly.length > 0;
  const bars = live ? hourly.slice(0, 6) : [];

  return (
    <Card
      icon="psychology"
      title="Predicción · próximas 6 horas"
      aside={<Badge tone="tertiary">{live ? 'Open-Meteo en vivo' : 'Datos de ejemplo'}</Badge>}
    >
      <div className="ha-forecast">
        {!live && <p className="ha-soft">Pronóstico no disponible. Reintenta más tarde.</p>}
        {bars.map((b) => (
          <div key={b.hour} className={`ha-forecast__col ha-tone-${toneFor(b.probability)}`}>
            <span className="ha-forecast__value ha-num ha-text-tone">{b.probability}%</span>
            <div className="ha-forecast__track">
              <div className="ha-forecast__bar" style={{ height: `${Math.max(b.probability, 4)}%` }} />
            </div>
            <span className="ha-forecast__hour ha-num ha-soft">{b.hour}</span>
          </div>
        ))}
      </div>

      <p className="ha-forecast__tip">
        <strong>Pronóstico:</strong> probabilidades de lluvia estimadas para las próximas horas. Consulta avisos oficiales antes de desplazarte.
      </p>
    </Card>
  );
}

function Toasts({ toasts, onDismiss }) {
  return (
    <div className="ha-toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`ha-toast ha-tone-${t.tone}`}>
          <Icon name={t.icon} className="ha-text-tone" />
          <div className="ha-toast__text">
            <p className="ha-toast__title">{t.title}</p>
            {t.message && <p className="ha-toast__message">{t.message}</p>}
          </div>
          <button onClick={() => onDismiss(t.id)} aria-label="Cerrar">
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

/* =========================================================================
 * 5. PANTALLA COMPLETA
 * ========================================================================= */

function PickLocation({ position, onPick }) {
  useMapEvents({ click(e) { onPick({ latitude: e.latlng.lat, longitude: e.latlng.lng, accuracy: 0 }); } });
  return position ? <CircleMarker center={[position.latitude, position.longitude]} radius={9} pathOptions={{color:'#006686'}} /> : null;
}

function ReportForm({ onClose, onCreated, notify }) {
  const [titulo, setTitulo] = useState('');
  const [descripcion, setDescripcion] = useState('');
  const [tipo, setTipo] = useState('inundacion');
  const [foto, setFoto] = useState(null);
  const [ubicacion, setUbicacion] = useState(null);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const locate = async () => {
    setLocating(true);
    try { setUbicacion(await getCurrentLocation()); }
    catch (error) { notify({ title: 'Ubicación no disponible', message: error.message, tone: 'error' }); }
    finally { setLocating(false); }
  };
  const submit = async (event) => {
    event.preventDefault(); setBusy(true);
    try {
      await createCitizenReport({ titulo, descripcion, tipo, foto, ubicacion });
      notify({ title: 'Reporte enviado', message: 'Tu incidencia ya está registrada en ARCA.', tone: 'success' });
      onCreated();
    } catch (error) { notify({ title: 'No se pudo guardar', message: error.message, tone: 'error' }); }
    finally { setBusy(false); }
  };
  return <section className="ha-card ha-report-form" aria-label="Nuevo reporte ciudadano">
    <div className="ha-card__header"><h3 className="ha-card__title"><Icon name="add_location_alt"/> Generar reporte ciudadano</h3><button onClick={onClose} type="button" aria-label="Cerrar formulario"><Icon name="close"/></button></div>
    <form onSubmit={submit} className="ha-report-fields">
      <label>Título del problema<input required minLength={5} maxLength={100} value={titulo} onChange={e => setTitulo(e.target.value)} placeholder="Ej. Fuga de agua en la calle" /></label>
      <label>Tipo de incidencia<select value={tipo} onChange={e => setTipo(e.target.value)}>{REPORT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}</select></label>
      <label>Descripción<textarea required minLength={10} maxLength={1500} rows={4} value={descripcion} onChange={e => setDescripcion(e.target.value)} placeholder="Describe lo que está ocurriendo..." /></label>
      <label>Fotografía (opcional; se comprime automáticamente)<input type="file" accept="image/*" capture="environment" onChange={e => setFoto(e.target.files?.[0] || null)} /></label>
      {foto && <p className="ha-soft">Archivo: {foto.name}</p>}
      <div className="ha-report-location"><button className="ha-btn" type="button" disabled={locating || busy} onClick={locate}><Icon name="my_location" size={18}/>{locating ? 'Obteniendo GPS...' : 'Obtener mi ubicación'}</button>
      {ubicacion ? <p>Ubicación seleccionada: {ubicacion.latitude.toFixed(6)}, {ubicacion.longitude.toFixed(6)} {ubicacion.accuracy ? `(precisión estimada ±${Math.round(ubicacion.accuracy)} m)` : '(seleccionada manualmente)'}</p> : <p className="ha-soft">Se necesita una ubicación para crear el reporte.</p>}</div>
      <div className="ha-report-location-map"><MapContainer center={ubicacion ? [ubicacion.latitude, ubicacion.longitude] : MAP_CENTER} zoom={ubicacion ? 16 : 12} style={{height:220,width:'100%'}} scrollWheelZoom={false}>
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors'/>
        <PickLocation position={ubicacion} onPick={setUbicacion}/><FlyTo colonia={ubicacion ? { position: [ubicacion.latitude, ubicacion.longitude] } : null}/>
      </MapContainer><p className="ha-soft">Puedes corregir el punto tocando el mapa. La ubicación manual no representa una medición GPS.</p></div>
      <div className="ha-report-actions"><button className="ha-btn" type="submit" disabled={busy || !ubicacion}>{busy ? 'Guardando...' : 'Enviar reporte'}</button><button type="button" onClick={onClose} disabled={busy}>Cancelar</button></div>
    </form>
  </section>;
}

export default function CitizenReports({ onLogout, profile: account }) {
  const [theme, toggleTheme] = useTheme();
  const weather = useWeather();
  const { toasts, notify, dismiss } = useToasts();
  const [focus, setFocus] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [citizenProfile, setCitizenProfile] = useState(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileError, setProfileError] = useState('');
  useEffect(() => subscribeCitizenProfile(
    data => { setCitizenProfile(data); setProfileLoading(false); setProfileError(''); },
    err => { setProfileError(err.message); setProfileLoading(false); }
  ), []);
  const profileComplete = !profileLoading && !profileError && isCitizenProfileComplete(citizenProfile);
  const beginReport = () => {
    if (profileLoading) return;
    if (!profileComplete) {
      setFormOpen(false);
      setProfileOpen(true);
      notify({ title: 'Completa tu perfil', message: 'Puedes consultar reportes, pero necesitas llenar tus datos antes de publicar.', tone: 'warning' });
      return;
    }
    setFormOpen(v => !v);
  };
  const [statsOpen, setStatsOpen] = useState(() => {
    try { return localStorage.getItem('arca-stats-open') !== 'false'; } catch { return true; }
  });
  useEffect(() => { try { localStorage.setItem('arca-stats-open', String(statsOpen)); } catch {} }, [statsOpen]);
  const [alertsOpen, setAlertsOpen] = useState(false);
  useEffect(() => subscribeReports(
    data => { setReports(data); setLoading(false); setError(''); },
    err => { setError(err.code === 'permission-denied' ? 'Las reglas de Firestore no permiten consultar los reportes.' : err.message); setLoading(false); }
  ), []);
  const currentUid = auth?.currentUser?.uid;
  const mine = reports.filter(r => r.usuarioUid === currentUid);
  const evidencias = reports.filter(r => r.fotoBase64).slice(0, 6).map(r => ({
    id: r.id, image: r.fotoBase64, tone: r.estado === 'resuelto' ? 'success' : 'warning',
    place: r.titulo, street: REPORT_TYPES.find(t => t.value === r.tipo)?.label || r.tipo,
    ai: `Estado: ${r.estado} · Reportó: ${r.autorNombre || 'Ciudadano (reporte anterior)'}`, time: r.creadoEn?.toDate?.().toLocaleString('es-MX') || 'Reciente',
  }));
  const alerts = mine.filter(r => r.estado === 'en-revision' || r.estado === 'resuelto').map(r => ({
    id: r.id, title: r.titulo, detail: r.estado === 'resuelto' ? 'Tu reporte fue resuelto' : 'Tu reporte está en revisión',
  }));
  return <div className="ha" data-theme={theme}>
    <Header weather={weather} theme={theme} onToggleTheme={toggleTheme} onLogout={onLogout} onOpenProfile={() => setProfileOpen(true)} profilePhoto={citizenProfile?.fotoBase64}/>
    <main className="ha-dashboard">
      <div className="ha-dashboard__intro"><div><Badge tone="primary" live>Reportes ciudadanos · Firebase</Badge><h1>Monitor Hídrico Metropolitano <span>| Veracruz – Boca del Río</span></h1><p className="ha-soft">Incidencias ciudadanas y seguimiento geográfico.</p></div>
      <button type="button" className="ha-btn" onClick={beginReport} disabled={profileLoading}><Icon name="add_location_alt" size={18}/>{formOpen ? 'Cerrar formulario' : 'Generar reporte'}</button></div>
      {!profileLoading && !profileComplete && <div className="ha-profile-gate" role="status">
        <Icon name="info" size={20}/><span>{profileError ? 'No se pudo verificar tu perfil.' : 'Para generar reportes necesitas completar tu perfil. Puedes seguir consultando el mapa y las incidencias.'}</span>
        <button type="button" onClick={() => setProfileOpen(true)}>Configurar perfil</button>
      </div>}
      <div className="ha-toolbar">
        <button type="button" className="ha-toolbar__button" onClick={() => setStatsOpen(v => !v)} aria-expanded={statsOpen}>
          <Icon name={statsOpen ? 'visibility_off' : 'visibility'} size={18}/>{statsOpen ? 'Ocultar estadísticas' : 'Mostrar estadísticas'}
        </button>
        <button type="button" className="ha-toolbar__button" onClick={() => setAlertsOpen(v => !v)} aria-expanded={alertsOpen}>
          <Icon name="notifications" size={18}/> Avisos de mis reportes ({alerts.length})
        </button>
      </div>
      {alertsOpen && <section className="ha-alert-center" aria-label="Avisos de reportes">
        <h3>Avisos de seguimiento</h3>
        {alerts.length ? alerts.map(a => <p key={a.id}><strong>{a.title}:</strong> {a.detail}</p>) : <p className="ha-soft">Todavía no hay cambios de estado que notificar. Los avisos de tandeos y riesgos requieren sus colecciones y reglas correspondientes.</p>}
      </section>}
      {formOpen && profileComplete && <ReportForm onClose={() => setFormOpen(false)} onCreated={() => setFormOpen(false)} notify={notify}/>}
      {loading && <p className="ha-soft">Cargando reportes...</p>}
      {error && <p role="alert" className="ha-report-error">{error}</p>}
      {statsOpen && <KpiCards colonias={[]} reports={reports}/>}
      <div className="ha-dashboard__grid"><div className="ha-dashboard__column">
        <RiskMap theme={theme} colonias={[]} fugas={[]} drenajes={[]} reports={reports} focus={focus} onSelect={setFocus}/>
        <Evidence evidencias={evidencias}/>
      </div><div className="ha-dashboard__column">
        <Card icon="assignment" title="Mis reportes" aside={<Badge tone="primary">{mine.length}</Badge>}>
          {mine.length === 0 ? <p className="ha-soft">Todavía no has enviado reportes.</p> : <ul className="ha-my-reports">{mine.map(r => <li key={r.id}><strong>{r.titulo}</strong><span className="ha-soft"> · {r.autorNombre || 'Ciudadano (reporte anterior)'}</span><Badge tone={r.estado === 'resuelto' ? 'success' : 'warning'}>{r.estado}</Badge><p className="ha-soft">{r.creadoEn?.toDate?.().toLocaleString('es-MX') || 'Reciente'}</p></li>)}</ul>}
        </Card>
        <Forecast hourly={weather.hourly}/>
      </div></div>
    </main>
    {profileOpen && <CitizenProfile account={account} profile={citizenProfile} onClose={() => setProfileOpen(false)} onSave={saveCitizenProfile}/>}
    <Toasts toasts={toasts} onDismiss={dismiss}/>
  </div>;
}
