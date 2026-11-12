/*
 * ARCA · Consola de Protección Civil (todo el módulo en un archivo).
 * Estilos: ArcaProteccionCivil.css (todo queda dentro de la clase .arca-pc).
 *
 * Requiere:  npm install leaflet react-leaflet   (React 18: react-leaflet@4.2.1)
 *
 * Uso:
 *   import ArcaProteccionCivil from './ArcaProteccionCivil';
 *   <ArcaProteccionCivil />
 *
 * Datos: hoy se guardan en el navegador (localStorage) con datos de ejemplo, en la sección "CAPA DE DATOS".
 *   No está conectada a los demás paneles. Para conectar la base de datos, solo se cambia el objeto `pcStore`:
 *   las alertas usan los mismos campos que los reportes de Protección Civil del panel de tandeo (systemReports)
 *   y "Publicar a la ciudadanía" guarda una noticia (notices) con la forma que leerá la app ciudadana.
 * Radio de peligro: IMPACT_RADIUS_M (50 m) en la sección "OPCIONES FIJAS".
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { Circle, CircleMarker, MapContainer, TileLayer, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './ArcaProteccionCivil.css';
import ArcaActivityFeed from './ArcaActivityFeed';
import { watchArcaActivity } from './proteccionCivilService';

/* ======================================================================
 * FECHAS
 * ====================================================================== */
// --- utils/dates.js
// Utilidades de fechas para el calendario.
const DAYS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// "2026-11-11" (en hora local, sin desfase de zona horaria)
function toKey(date) {
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${m}-${d}`;
}

function addDays(date, days) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

// Lunes de la semana de `date`
function startOfWeek(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  return addDays(d, -((d.getDay() + 6) % 7));
}

const dayLabel = (date) => `${DAYS[date.getDay()]} ${date.getDate()}`;

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Día 1 del mes de `date`
const startOfMonth = (date = new Date()) => new Date(date.getFullYear(), date.getMonth(), 1);

const addMonths = (date, months) => new Date(date.getFullYear(), date.getMonth() + months, 1);

const monthLabel = (date) => `${MONTH_NAMES[date.getMonth()]} ${date.getFullYear()}`;

// Cuadrícula del mes en semanas completas (lunes a domingo)
function monthGrid(firstDay) {
  const start = startOfWeek(firstDay);
  const last = new Date(firstDay.getFullYear(), firstDay.getMonth() + 1, 0);
  const days = Math.round((startOfWeek(last) - start) / 86400000) + 7;
  return Array.from({ length: days }, (_, i) => addDays(start, i));
}

const longDayLabel = (date) => `${dayLabel(date)} de ${MONTH_NAMES[date.getMonth()]}`;

const isToday = (date) => toKey(date) === toKey(new Date());

// "hace 5 min", "hace 2 h", "hace 3 d"
function timeAgo(iso) {
  const minutes = Math.round((Date.now() - new Date(iso)) / 60000);
  if (minutes < 60) return `hace ${Math.max(minutes, 1)} min`;
  if (minutes < 1440) return `hace ${Math.round(minutes / 60)} h`;
  return `hace ${Math.round(minutes / 1440)} d`;
}

/* ======================================================================
 * FOTOS
 * ====================================================================== */
// --- utils/images.js
// Convierte una foto a JPEG reducido (data URL) para que ocupe poco al guardarla.
function photoToDataUrl(file) {
  if (!file.type.startsWith('image/')) return Promise.reject(Error('Selecciona una imagen.'));
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        let width = Math.min(image.width, 900);
        let height = Math.round(image.height * width / image.width);
        const canvas = document.createElement('canvas');
        for (let attempt = 0; attempt < 7; attempt++) {
          canvas.width = width;
          canvas.height = height;
          canvas.getContext('2d').drawImage(image, 0, 0, width, height);
          const data = canvas.toDataURL('image/webp', Math.max(0.35, 0.72 - attempt * 0.065));
          if (data.length <= 160000 && data.startsWith('data:image/webp;')) {
            resolve(data);
            return;
          }
          width = Math.max(240, Math.round(width * 0.82));
          height = Math.max(180, Math.round(height * 0.82));
        }
        reject(Error('No fue posible comprimir la foto. Usa otra imagen.'));
      } catch (error) { reject(error); }
      finally { URL.revokeObjectURL(url); }
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(Error('No se pudo abrir la foto.')); };
    image.src = url;
  });
}

/* ======================================================================
 * OPCIONES FIJAS
 * ====================================================================== */
// --- modules/proteccion-civil/constants.js
// Opciones fijas de la consola de Protección Civil (mismos valores que usa el panel de tandeo).

// Riesgos para la población
const RISK_TYPES = {
  derrumbe: { label: 'Derrumbe o deslave', icon: 'landslide' },
  'fuga-gas': { label: 'Fuga de gas', icon: 'gas_meter' },
  incendio: { label: 'Incendio', icon: 'local_fire_department' },
  explosion: { label: 'Explosión', icon: 'crisis_alert' },
  inundacion: { label: 'Inundación', icon: 'flood' },
  'riesgo-otro': { label: 'Otro riesgo', icon: 'warning' },
};

// Nivel de riesgo: priority ordena la lista (mayor = más urgente)
const RISK_LEVELS = {
  critico: { label: 'Crítico', long: 'Riesgo crítico', tone: 'error', priority: 3 },
  alto: { label: 'Alto', long: 'Riesgo alto', tone: 'warning', priority: 2 },
  medio: { label: 'Medio', long: 'Riesgo medio', tone: 'tertiary', priority: 1 },
};

/*
 * Estado de una alerta:
 * - enviada: todavía no se publica (status 'nuevo'). La puede publicar Protección Civil o el admin de tandeo.
 * - publicada: ya está en la app ciudadana (status 'publicado'; `alert.by` dice quién la publicó)
 * - controlada: Protección Civil cerró el riesgo (campo `closure`)
 */
const ALERT_STATES = {
  enviada: { label: 'Por publicar', short: 'Por publicar', tone: 'warning' },
  publicada: { label: 'Publicada a la ciudadanía', short: 'Publicada', tone: 'primary' },
  controlada: { label: 'Riesgo controlado', short: 'Controlada', tone: 'success' },
};

function alertState(alert) {
  if (alert.closure) return 'controlada';
  return alert.status === 'publicado' ? 'publicada' : 'enviada';
}

// Unidades de guardia
const SHIFTS = { matutino: 'Matutino', vespertino: 'Vespertino', nocturno: 'Nocturno' };

const UNIT_STATUS = {
  rondin: { label: 'En rondín', tone: 'primary' },
  atendiendo: { label: 'Atendiendo riesgo', tone: 'warning' },
  disponible: { label: 'Disponible', tone: 'success' },
  fuera: { label: 'Fuera de servicio', tone: 'neutral' },
};

const MAP_CENTER = [19.176, -96.138];

// Radio de impacto alrededor del punto del riesgo, en metros
const IMPACT_RADIUS_M = 50;

/* Datos en vivo compartidos con Red y Tandeo. Sin registros de demostración. */
import {
  watchPcSectors, watchPcAlerts, watchPcUnits,
  savePcAlert, removePcAlert, publishPcAlert, controlPcAlert, syncPcControlledNotice, withdrawPcPublication,
  savePcUnit, removePcUnit,
} from './proteccionCivilService';

/* ======================================================================
 * NOTIFICACIONES
 * ====================================================================== */
// --- context/ToastContext.jsx
// Notificaciones flotantes. Se dibujan en <Toasts />, encima de la página.
const ToastContext = createContext(null);

function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = (id) => setToasts((list) => list.filter((t) => t.id !== id));

  // notify({ title, message, tone, icon })
  const notify = (toast) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { id, tone: 'primary', icon: 'info', ...toast }].slice(-3));
    setTimeout(() => dismiss(id), 4500);
  };

  return <ToastContext.Provider value={{ toasts, notify, dismiss }}>{children}</ToastContext.Provider>;
}

const useToast = () => useContext(ToastContext);

/* ======================================================================
 * PIEZAS BÁSICAS
 * ====================================================================== */
// --- components/Icon.jsx
// Ícono de Google Material Symbols. Ej: <Icon name="map" />
function Icon({ name, size = 20, className = '' }) {
  return (
    <span className={`material-symbols-outlined ${className}`} style={{ fontSize: size }} aria-hidden="true">
      {name}
    </span>
  );
}

// --- components/Badge/Badge.jsx
// Etiqueta de color. tone: primary | secondary | tertiary | success | warning | error | neutral
function Badge({ tone = 'neutral', live = false, children }) {
  return (
    <span className={`badge tone-${tone}`}>
      {live && <span className="live-dot" />}
      {children}
    </span>
  );
}

// --- components/Button/Button.jsx
// Botón. variant: primary | secondary | danger | ghost | alert
function Button({ variant = 'secondary', icon, children, ...props }) {
  return (
    <button type="button" className={`btn btn--${variant}`} {...props}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

// --- components/Modal/Modal.jsx
// Ventana flotante. Se cierra con la X, con Escape o tocando el fondo.
function Modal({ title, onClose, children, footer }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal__panel" role="dialog" aria-modal="true" aria-label={title}>
        <header className="modal__header">
          <h3>{title}</h3>
          <button onClick={onClose} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>
        <div className="modal__body">{children}</div>
        {footer && <footer className="modal__footer">{footer}</footer>}
      </div>
    </div>
  );
}

// --- components/Toasts/Toasts.jsx
// Capa fija de notificaciones: flota encima y nunca empuja la página.
function Toasts() {
  const { toasts, dismiss } = useToast();

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast tone-${t.tone}`}>
          <Icon name={t.icon} className="text-tone" />
          <div className="toast__text">
            <p className="toast__title">{t.title}</p>
            {t.message && <p className="toast__message">{t.message}</p>}
          </div>
          <button onClick={() => dismiss(t.id)} aria-label="Cerrar">
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}

// --- components/Header/Header.jsx
// Barra superior de la consola de Protección Civil.
function Header({ onLogout }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="header">
      <div className="header__brand">
        <Logo />
        <div>
          <p className="header__name">
            ARCA <strong>Protección Civil</strong>
          </p>
          <p className="header__tagline">Riesgos para la población · Veracruz – Boca del Río</p>
        </div>
        <Badge tone="error" live>Consola táctica</Badge>
      </div>

      <div className="header__tools">
        <a className="header__emergency" href="tel:911">
          <Icon name="emergency" size={16} /> Emergencias 911
        </a>
        <button className="header__theme" onClick={toggleTheme} aria-label="Cambiar tema">
          <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
        </button>
        <button className="pc-logout" type="button" onClick={onLogout}>
          <Icon name="logout" size={17} /><span>Salir</span>
        </button>
      </div>
    </header>
  );
}

/* ======================================================================
 * MAPA TÁCTICO
 * ====================================================================== */
// --- modules/proteccion-civil/map/RiskMap.jsx
// Tamaño del punto en pantalla (el radio de impacto real va aparte, en metros)
const RADIUS = { critico: 8, alto: 7, medio: 6 };

// Mueve el mapa a la zona o a la alerta elegida
function FlyTo({ target, zoom }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, zoom, { duration: 0.8 });
  }, [target, zoom, map]);
  return null;
}

// Mapa táctico: riesgos activos por nivel con su radio de impacto (en metros reales).
function RiskMap({ alerts, sectors, zone, selected, onSelect, externalFocus, externalItems = [], onSelectExternal }) {
  const { theme } = useTheme();
  const zoneSector = sectors.find((s) => s.id === zone);
  // Solo riesgos activos (y el seleccionado aunque ya esté controlado)
  const points = alerts.filter((a) => a.position && !a.publicationRetired && (alertState(a) !== 'controlada' || a.status === 'publicado' || a.id === selected?.id));

  return (
    <section className={`riskmap riskmap--${theme}`}>
      <div className="riskmap__badge">
        <span className="live-dot" /> Radar táctico · en vivo
      </div>

      <MapContainer center={MAP_CENTER} zoom={13} maxZoom={19} scrollWheelZoom={false} className="riskmap__canvas">
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        />
        <FlyTo target={zoneSector?.center ?? (zone === 'todas' ? MAP_CENTER : null)} zoom={zoneSector ? 14 : 13} />
        {/* Zoom 17 para que el radio de impacto se vea completo */}
        <FlyTo target={externalFocus || selected?.position} zoom={17} />

        {externalItems.filter((item) => item.origin !== 'proteccion-civil' && item.position && (zone === 'todas' || !item.sectorId || item.sectorId === zone)).map((item) => (
          <CircleMarker
            key={item.key}
            center={item.position}
            radius={6}
            pathOptions={{ color: item.origin === 'ciudadania' ? '#1685ad' : item.origin === 'aviso' ? '#8058c3' : '#dea630', fillOpacity: 0.85, weight: 2 }}
            eventHandlers={{ click: () => onSelectExternal(item.position) }}
          >
            <Tooltip direction="top">
              <strong>{item.origin === 'ciudadania' ? 'Reporte ciudadano' : item.origin === 'aviso' ? 'Aviso institucional' : 'Reporte de Operaciones'}</strong>
              <br />{item.title}
            </Tooltip>
          </CircleMarker>
        ))}
        {points.map((a) => {
          const level = RISK_LEVELS[a.level];
          const type = RISK_TYPES[a.type] ?? RISK_TYPES['riesgo-otro'];
          const isSelected = a.id === selected?.id;
          const controlled = Boolean(a.closure);
          const tone = controlled ? 'success' : level.tone;
          return [
            <Circle
              key={`${a.id}-radio`}
              center={a.position}
              radius={a.radius ?? IMPACT_RADIUS_M}
              className={`riskmap__impact tone-${tone} ${controlled ? 'is-controlled' : ''}`}
              pathOptions={controlled ? { color: '#168956', fillColor: '#168956', fillOpacity: .08, weight: 1 } : undefined}
              interactive={false}
            />,
            <CircleMarker
              key={`${a.id}-${isSelected}-${controlled}`}
              center={a.position}
              radius={(RADIUS[a.level] || 7) + (isSelected ? 2 : 0)}
              className={`riskmap__point tone-${tone} ${!controlled && a.level === 'critico' ? 'is-critical' : ''} ${controlled ? 'is-controlled' : ''} ${isSelected ? 'is-selected' : ''}`}
              pathOptions={controlled ? { color: '#126a43', fillColor: '#168956', fillOpacity: .95, weight: 3 } : undefined}
              eventHandlers={{ click: () => onSelect(a.id) }}
            >
              <Tooltip direction="top">
                <strong>
                  {type.label} · {controlled ? 'Riesgo controlado' : level.long}
                </strong>
                <br />
                {a.colonia}
              </Tooltip>
            </CircleMarker>,
          ];
        })}
      </MapContainer>

      <div className="riskmap__legend">
        <span className="label">Nivel de riesgo</span>
        {Object.values(RISK_LEVELS).map((l) => (
          <span key={l.label} className={`tone-${l.tone}`}>
            <i /> {l.long}
          </span>
        ))}
        <span className="riskmap__legend-zone">
          <Icon name="radio_button_unchecked" size={14} /> Radio de impacto ({IMPACT_RADIUS_M} m)
        </span>
      </div>
    </section>
  );
}

// --- modules/proteccion-civil/map/PointPicker.jsx
// Toca el mapa para mover el punto
function ClickToMove({ onChange }) {
  useMapEvents({ click: (e) => onChange([e.latlng.lat, e.latlng.lng]) });
  return null;
}

// Mantiene el punto a la vista cuando cambia de sector
function Follow({ position }) {
  const map = useMap();
  useEffect(() => {
    if (position) map.setView(position, map.getZoom());
  }, [position, map]);
  return null;
}

// Mapa chico del formulario para marcar el lugar exacto del riesgo y su radio de impacto.
function PointPicker({ position, onChange }) {
  const { theme } = useTheme();
  const point = position ?? MAP_CENTER;

  return (
    <div className={`picker riskmap--${theme}`}>
      <MapContainer center={point} zoom={17} maxZoom={19} scrollWheelZoom={false} className="picker__canvas">
        <TileLayer url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="&copy; OpenStreetMap" />
        <ClickToMove onChange={onChange} />
        <Follow position={point} />
        <Circle center={point} radius={IMPACT_RADIUS_M} className="riskmap__impact tone-error" interactive={false} />
        <CircleMarker center={point} radius={6} className="riskmap__point tone-error is-selected" />
      </MapContainer>
    </div>
  );
}

/* ======================================================================
 * ALERTAS DE RIESGO
 * ====================================================================== */
// --- modules/proteccion-civil/alerts/PhotoPicker.jsx
const MAX_PHOTOS = 1;

// Selector de fotos de evidencia (mínimo 1, máximo 3).
function PhotoPicker({ photos, onChange }) {
  const [loading, setLoading] = useState(false);

  const add = async (e) => {
    const files = [...e.target.files].slice(0, MAX_PHOTOS - photos.length);
    e.target.value = '';
    if (!files.length) return;
    setLoading(true);
    try {
      onChange([...photos, ...(await Promise.all(files.map((f) => photoToDataUrl(f))))]);
    } catch {
      window.alert('Una de las imágenes no se pudo leer. Intenta con otra.');
    }
    setLoading(false);
  };

  return (
    <div className="photos-pick">
      {photos.map((src, i) => (
        <div key={i} className="photos-pick__item">
          <img src={src} alt={`Evidencia ${i + 1}`} />
          <button type="button" onClick={() => onChange(photos.filter((_, j) => j !== i))} aria-label="Quitar foto">
            <Icon name="close" size={16} />
          </button>
        </div>
      ))}

      {photos.length < MAX_PHOTOS && (
        <label className="photos-pick__add">
          <Icon name={loading ? 'hourglass_top' : 'add_a_photo'} />
          <span>{loading ? 'Cargando…' : 'Agregar foto'}</span>
          <input type="file" accept="image/*" multiple onChange={add} disabled={loading} />
        </label>
      )}
    </div>
  );
}

// --- modules/proteccion-civil/alerts/AlertList.jsx
const TABS = [
  { id: 'activas', label: 'Activas', match: (s) => s !== 'controlada' },
  { id: 'enviada', label: 'Por publicar', match: (s) => s === 'enviada' },
  { id: 'publicada', label: 'Publicadas', match: (s) => s === 'publicada' },
  { id: 'controlada', label: 'Controladas', match: (s) => s === 'controlada' },
];

// Código corto para nombrar la alerta por radio: PC-1A2B
const alertCode = (alert) => `PC-${alert.id.slice(-4).toUpperCase()}`;

// Alertas ordenadas por urgencia: primero el nivel de riesgo, luego la más reciente.
function AlertList({ alerts, sectors, selectedId, onSelect }) {
  const [tab, setTab] = useState('activas');
  const sectorName = (id) => sectors.find((s) => s.id === id)?.name ?? 'Sin sector';
  const match = TABS.find((t) => t.id === tab).match;
  const visible = alerts
    .filter((a) => match(alertState(a)))
    .sort((a, b) => RISK_LEVELS[b.level].priority - RISK_LEVELS[a.level].priority || new Date(b.createdAt) - new Date(a.createdAt));

  return (
    <section className="alerts">
      <header className="alerts__head">
        <h3>
          <Icon name="crisis_alert" /> Alertas priorizadas
        </h3>
        <div className="alerts__tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
              {t.label} <span className="num">{alerts.filter((a) => t.match(alertState(a))).length}</span>
            </button>
          ))}
        </div>
      </header>

      {visible.length === 0 && (
        <p className="alerts__empty soft">
          <Icon name="verified_user" /> Sin alertas en esta sección.
        </p>
      )}

      <ul className="alerts__list">
        {visible.map((a) => {
          const level = RISK_LEVELS[a.level];
          const type = RISK_TYPES[a.type] ?? RISK_TYPES['riesgo-otro'];
          const state = ALERT_STATES[alertState(a)];
          return (
            <li key={a.id}>
              <button className={`alert tone-${level.tone} ${a.id === selectedId ? 'is-selected' : ''}`} onClick={() => onSelect(a.id)}>
                <span className="alert__top">
                  <span className="alert__code num">{alertCode(a)}</span>
                  <Badge tone={level.tone}>{level.label}</Badge>
                  <span className="alert__time soft">{timeAgo(a.createdAt)}</span>
                </span>
                <span className="alert__title">
                  <Icon name={type.icon} size={18} />
                  <strong>
                    {type.label} · {a.colonia}
                  </strong>
                </span>
                <span className="alert__desc">{a.description}</span>
                <span className="alert__meta soft">
                  {sectorName(a.sectorId)} · {a.reporter}
                </span>
                <Badge tone={state.tone}>{state.short}</Badge>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- modules/proteccion-civil/alerts/AlertDetail.jsx
// Ventana para dar por controlado el riesgo
function CloseModal({ alert, onConfirm, onClose }) {
  const [note, setNote] = useState('');
  return (
    <Modal
      title={`Riesgo controlado · ${alertCode(alert)}`}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon="verified_user" type="submit" form="close-form">
            Marcar como controlado
          </Button>
        </>
      }
    >
      <form
        id="close-form"
        className="modal__body-form"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(note.trim());
        }}
      >
        <p className="alert-intro">
          <Icon name="info" size={18} />
          <span>El marcador pasará de rojo a verde y permanecerá visible hasta retirar la publicación. El historial se conserva.</span>
        </p>
        <label className="field">
          ¿Cómo se controló?
          <textarea
            className="input"
            required
            minLength={10}
            maxLength={280}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. Bomberos sofocaron el incendio y se retiró el acordonamiento."
          />
        </label>
      </form>
    </Modal>
  );
}

// Ventana para publicar la alerta en la app ciudadana
function PublishModal({ alert, sectorName, onConfirm, onClose }) {
  const type = RISK_TYPES[alert.type] ?? RISK_TYPES['riesgo-otro'];
  const [title, setTitle] = useState(`${type.label} en ${sectorName}`);
  const [message, setMessage] = useState(
    `${alert.description} Si vives en ${sectorName} (${alert.colonia}), toma precauciones y sigue las indicaciones de Protección Civil.`,
  );
  return (
    <Modal
      title="Publicar a la ciudadanía"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="alert" icon="campaign" type="submit" form="publish-form">
            Publicar alerta
          </Button>
        </>
      }
    >
      <form
        id="publish-form"
        className="modal__body-form"
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm({ title: title.trim(), message: message.trim() });
        }}
      >
        <p className="alert-intro">
          <Icon name="campaign" size={18} />
          <span>
            Se publica en la app ciudadana para <strong>toda la ciudadanía</strong>. A quienes viven en{' '}
            <strong>{sectorName}</strong> les llega como alerta prioritaria.
          </span>
        </p>
        <label className="field">
          Título
          <input className="input" required maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="field">
          Mensaje para la ciudadanía
          <textarea className="input" required maxLength={400} value={message} onChange={(e) => setMessage(e.target.value)} />
        </label>
      </form>
    </Modal>
  );
}

// Detalle de la alerta seleccionada: fotos, estado y acciones.
function AlertDetail({ alert, sectors, onEdit, onChange, onRemoved }) {
  const { notify } = useToast();
  const [modal, setModal] = useState(null); // { kind: 'close' | 'publish' } | { kind: 'photo', index }

  if (!alert) {
    return (
      <section className="detail detail--empty soft">
        <Icon name="touch_app" /> Selecciona una alerta de la lista o del mapa para ver su detalle.
      </section>
    );
  }

  const level = RISK_LEVELS[alert.level];
  const type = RISK_TYPES[alert.type] ?? RISK_TYPES['riesgo-otro'];
  const stateId = alertState(alert);
  const state = ALERT_STATES[stateId];
  const sector = sectors.find((s) => s.id === alert.sectorId);
  const photos = alert.photos ?? [];

  const close = async (note) => {
    try {
      await controlPcAlert(alert.id, note);
      notify({ title: 'Riesgo controlado', message: `${type.label} · ${alert.colonia}`, tone: 'success', icon: 'verified_user' });
      setModal(null);
    } catch (error) { notify({ title: 'Error de Firebase', message: error.message, tone: 'error' }); }
  };

  const publish = async (notice) => {
    try {
      await publishPcAlert(alert, notice);
      notify({ title: 'Alerta publicada', message: `Toda la ciudadanía · prioritaria en ${sector?.name}`, tone: 'success', icon: 'campaign' });
      setModal(null);
    } catch (error) { notify({ title: 'Error al publicar', message: error.message, tone: 'error' }); }
  };

  const syncNotice = async () => {
    try {
      const result = await syncPcControlledNotice(alert.id);
      notify({ title: 'Aviso actualizado', message: result.synced ? 'El marcador ciudadano ahora debe verse verde.' : 'La publicación ya estaba sincronizada.', tone: 'success', icon: 'check_circle' });
    } catch (error) {
      console.error('[ARCA] Falló actualizar aviso:', error);
      notify({ title: 'Error al sincronizar aviso', message: error.message, tone: 'error' });
    }
  };

  const withdraw = async () => {
    if (!window.confirm('¿Retirar esta publicación de la vista ciudadana? El reporte controlado seguirá en el historial de Protección Civil.')) return;
    try {
      await withdrawPcPublication(alert);
      notify({ title: 'Publicación retirada', message: 'La alerta dejará de aparecer en Ciudadanía.', tone: 'success', icon: 'check_circle' });
    } catch (error) { console.error('[ARCA] Falló retirar publicación:', error); notify({ title: 'Error al retirar publicación', message: `${error.message}${error.code ? ` (${error.code})` : ''}`, tone: 'error' }); }
  };

  const remove = async () => {
    if (!window.confirm(`¿Eliminar la alerta ${alertCode(alert)}? Todavía no se ha publicado.`)) return;
    try {
      await removePcAlert(alert.id);
      onRemoved();
      notify({ title: 'Alerta eliminada', message: alertCode(alert), tone: 'warning', icon: 'delete' });
    } catch (error) { console.error('[ARCA] Falló eliminar borrador:', error); notify({ title: 'Error al eliminar', message: `${error.message}${error.code ? ` (${error.code})` : ''}`, tone: 'error' }); }
  };

  return (
    <section className={`detail tone-${level.tone}`}>
      <div className="detail__photos">
        {photos.map((src, i) => (
          <button key={i} style={{ backgroundImage: `url(${src})` }} onClick={() => setModal({ kind: 'photo', index: i })}>
            <span className="sr-only">Ver foto {i + 1}</span>
          </button>
        ))}
      </div>

      <div className="detail__body">
        <div className="detail__head">
          <span className="detail__icon">
            <Icon name={type.icon} />
          </span>
          <div className="detail__title">
            <strong>
              {type.label} · {alert.colonia}
            </strong>
            <span className="soft num">
              {alertCode(alert)} · {sector?.name} · {alert.reporter} · {timeAgo(alert.createdAt)}
            </span>
          </div>
          <Badge tone={level.tone}>{level.long}</Badge>
        </div>

        <p>{alert.description}</p>

        <p className={`detail__state tone-${state.tone}`}>
          <Icon name={stateId === 'enviada' ? 'schedule_send' : stateId === 'publicada' ? 'campaign' : 'verified_user'} size={18} />
          <span>
            <strong>{state.label}.</strong>{' '}
            {stateId === 'enviada' &&
              'Publícala tú desde aquí o espera a que lo haga el admin de tandeo. Llega a toda la ciudadanía, prioritaria en el sector.'}
            {stateId !== 'enviada' &&
              alert.alert &&
              `${alert.alert.by ? `Publicó: ${alert.alert.by}. ` : ''}Aviso: “${alert.alert.message}” · ${timeAgo(alert.alert.at)}`}
            {stateId === 'controlada' && ` Cierre: “${alert.closure.note}” · ${timeAgo(alert.closure.at)}`}
          </span>
        </p>

        <div className="detail__actions">
          {stateId === 'enviada' && (
            <Button variant="alert" icon="campaign" onClick={() => setModal({ kind: 'publish' })}>
              Publicar a la ciudadanía
            </Button>
          )}
          {stateId !== 'controlada' && (
            <Button variant={stateId === 'enviada' ? 'secondary' : 'primary'} icon="verified_user" onClick={() => setModal({ kind: 'close' })}>
              Riesgo controlado
            </Button>
          )}
          {stateId === 'controlada' && alert.alert && !alert.publicationRetired && (
            <>
              <Button variant="ghost" icon="sync" onClick={syncNotice}>
                Actualizar aviso ciudadano
              </Button>
              <Button variant="secondary" icon="visibility_off" onClick={withdraw}>
                Retirar publicación
              </Button>
            </>
          )}
          <span className="detail__spacer" />
          {stateId === 'enviada' && (
            <>
              <Button variant="ghost" icon="edit" onClick={() => onEdit(alert)}>
                Editar
              </Button>
              <Button variant="ghost" icon="delete" onClick={remove}>
                Eliminar
              </Button>
            </>
          )}
        </div>
      </div>

      {modal?.kind === 'publish' && (
        <PublishModal alert={alert} sectorName={sector?.name ?? 'el sector'} onConfirm={publish} onClose={() => setModal(null)} />
      )}
      {modal?.kind === 'close' && <CloseModal alert={alert} onConfirm={close} onClose={() => setModal(null)} />}
      {modal?.kind === 'photo' && (
        <Modal title={`Foto ${modal.index + 1} de ${photos.length}`} onClose={() => setModal(null)}>
          <img className="detail__photo-big" src={photos[modal.index]} alt="Evidencia de la alerta" />
          {photos.length > 1 && (
            <div className="detail__thumbs">
              {photos.map((src, i) => (
                <button
                  key={i}
                  className={i === modal.index ? 'is-active' : ''}
                  style={{ backgroundImage: `url(${src})` }}
                  onClick={() => setModal({ kind: 'photo', index: i })}
                  aria-label={`Ver foto ${i + 1}`}
                />
              ))}
            </div>
          )}
        </Modal>
      )}
    </section>
  );
}

// --- modules/proteccion-civil/alerts/AlertForm.jsx
// Nueva alerta de riesgo (o edición mientras no se haya publicado).
function AlertForm({ alert, sectors, units, onSave, onClose }) {
  const active = sectors.filter((s) => s.active !== false);
  const firstSector = active[0];
  const [form, setForm] = useState({
    type: 'fuga-gas',
    level: 'alto',
    sectorId: firstSector?.id ?? '',
    colonia: '',
    reporter: units[0]?.name ?? '',
    description: '',
    photos: [],
    position: firstSector?.center,
    ...alert,
  });
  const [error, setError] = useState('');
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });
  const sector = sectors.find((s) => s.id === form.sectorId);

  // Al cambiar de sector, el punto se mueve al centro del sector (luego se puede ajustar en el mapa)
  const setSector = (e) => {
    const next = sectors.find((s) => s.id === e.target.value);
    setForm({ ...form, sectorId: next.id, position: next.center });
  };

  const submit = (e) => {
    e.preventDefault();
    if (!form.photos.length) return setError('Agrega al menos una foto: el admin de tandeo la necesita para verificar la alerta.');
    onSave({ ...form, colonia: form.colonia.trim(), description: form.description.trim() });
  };

  return (
    <Modal
      title={alert.id ? 'Editar alerta' : 'Nueva alerta de riesgo'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="alert" icon="send" type="submit" form="alert-form">
            {alert.id ? 'Guardar cambios' : 'Registrar alerta'}
          </Button>
        </>
      }
    >
      <form id="alert-form" className="modal__body-form" onSubmit={submit}>
        {!alert.id && (
          <p className="alert-intro">
            <Icon name="campaign" size={18} />
            <span>
              Después de guardarla puedes <strong>publicarla tú</strong> a la ciudadanía desde el detalle, o dejar que la publique
              el admin de tandeo. El radio de peligro es de 50 m alrededor del punto.
            </span>
          </p>
        )}

        <div className="field-row">
          <label className="field">
            Tipo de riesgo
            <select className="input" value={form.type} onChange={set('type')}>
              {Object.entries(RISK_TYPES).map(([value, t]) => (
                <option key={value} value={value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Sector afectado
            <select className="input" value={form.sectorId} onChange={setSector}>
              {active.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          Nivel de riesgo para los habitantes
          <div className="choices">
            {Object.entries(RISK_LEVELS).map(([value, l]) => (
              <label key={value} className={`choice tone-${l.tone}`}>
                <input type="radio" name="level" value={value} checked={form.level === value} onChange={set('level')} />
                {l.long}
              </label>
            ))}
          </div>
        </div>

        <div className="field-row">
          <label className="field">
            Ubicación
            <input className="input" required maxLength={80} value={form.colonia} onChange={set('colonia')} placeholder="Ej. Col. Virginia" />
          </label>
          <label className="field">
            Unidad que reporta
            <select className="input" value={form.reporter} onChange={set('reporter')}>
              {units.map((u) => (
                <option key={u.id} value={u.name}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="field">
          Punto exacto (toca el mapa para moverlo)
          <PointPicker
            position={form.position ?? sector?.center}
            onChange={(position) => setForm({ ...form, position })}
          />
        </div>

        <label className="field">
          ¿Qué está pasando?
          <textarea
            className="input"
            required
            maxLength={280}
            value={form.description}
            onChange={set('description')}
            placeholder="Ej. Olor fuerte a gas junto a un registro. Se acordonó la zona."
          />
        </label>

        <div className="field">
          Foto de evidencia (obligatoria, comprimida)
          <PhotoPicker
            photos={form.photos}
            onChange={(photos) => {
              setForm({ ...form, photos });
              setError('');
            }}
          />
        </div>

        {error && (
          <p className="alert-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

/* ======================================================================
 * PANEL LATERAL
 * ====================================================================== */
// --- modules/proteccion-civil/side/SectorPanorama.jsx
// Panorama por sector: cuántos riesgos activos tiene y el más alto. Tocar un sector filtra la consola.
function SectorPanorama({ alerts, sectors, onZone }) {
  return (
    <section className="side-card">
      <h3 className="side-card__title">
        <Icon name="hub" /> Panorama por sector
      </h3>
      <ul className="panorama">
        {sectors.map((s) => {
          const active = alerts.filter((a) => a.sectorId === s.id && alertState(a) !== 'controlada');
          const top = active.reduce((max, a) => (!max || RISK_LEVELS[a.level].priority > RISK_LEVELS[max].priority ? a.level : max), null);
          const level = top && RISK_LEVELS[top];
          return (
            <li key={s.id}>
              <button className={`panorama__item tone-${level ? level.tone : 'success'}`} onClick={() => onZone(s.id)}>
                <span className="panorama__bar" />
                <span className="panorama__text">
                  <strong>{s.name}</strong>
                  <span className="soft">{s.colonias}</span>
                </span>
                {level ? (
                  <Badge tone={level.tone}>
                    {active.length} · {level.label}
                  </Badge>
                ) : (
                  <Badge tone="success">Sin riesgos</Badge>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// --- modules/proteccion-civil/side/UnitForm.jsx
// Alta o edición de una unidad de guardia.
function UnitForm({ unit, sectors, onSave, onRemove, onClose }) {
  const [form, setForm] = useState({ name: '', leader: '', shift: 'matutino', status: 'rondin', sectorId: sectors[0]?.id ?? '', ...unit });
  const set = (field) => (e) => setForm({ ...form, [field]: e.target.value });

  const submit = (e) => {
    e.preventDefault();
    onSave({ ...form, name: form.name.trim(), leader: form.leader.trim() });
  };

  return (
    <Modal
      title={unit.id ? 'Editar unidad' : 'Agregar unidad'}
      onClose={onClose}
      footer={
        <>
          {unit.id && (
            <Button variant="danger" icon="delete" onClick={onRemove}>
              Quitar
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon="save" type="submit" form="unit-form">
            Guardar
          </Button>
        </>
      }
    >
      <form id="unit-form" className="modal__body-form" onSubmit={submit}>
        <div className="field-row">
          <label className="field">
            Nombre de la unidad
            <input className="input" required autoFocus maxLength={40} value={form.name} onChange={set('name')} placeholder="Ej. Unidad 15" />
          </label>
          <label className="field">
            Responsable
            <input className="input" required maxLength={60} value={form.leader} onChange={set('leader')} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            Turno
            <select className="input" value={form.shift} onChange={set('shift')}>
              {Object.entries(SHIFTS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Sector que vigila
            <select className="input" value={form.sectorId} onChange={set('sectorId')}>
              {sectors.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="field">
          Estado
          <div className="choices">
            {Object.entries(UNIT_STATUS).map(([value, s]) => (
              <label key={value} className={`choice tone-${s.tone}`}>
                <input type="radio" name="status" value={value} checked={form.status === value} onChange={set('status')} />
                {s.label}
              </label>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

// --- modules/proteccion-civil/side/UnitsPanel.jsx
// Unidades de guardia: quién está en servicio, en qué sector y con qué estado.
function UnitsPanel({ units, sectors, onChange }) {
  const { notify } = useToast();
  const [editing, setEditing] = useState(null); // unidad en el formulario ({} = nueva)
  const sectorName = (id) => sectors.find((s) => s.id === id)?.name ?? 'Sin sector';
  const onDuty = units.filter((u) => u.status !== 'fuera').length;

  const save = async (unit) => {
    try {
      await savePcUnit(unit);
      notify({ title: unit.id ? 'Unidad actualizada' : 'Unidad agregada', message: unit.name, tone: 'success', icon: 'local_police' });
      setEditing(null);
    } catch (error) { notify({ title: 'Error al guardar unidad', message: error.message, tone: 'error' }); }
  };

  const setStatus = async (unit, status) => {
    try {
      await savePcUnit({ ...unit, status });
      notify({ title: unit.name, message: UNIT_STATUS[status].label, tone: UNIT_STATUS[status].tone, icon: 'local_police' });
    } catch (error) { notify({ title: 'Error de Firebase', message: error.message, tone: 'error' }); }
  };

  const remove = async (unit) => {
    if (!window.confirm(`¿Quitar la ${unit.name}?`)) return;
    try {
      await removePcUnit(unit.id);
      setEditing(null);
      notify({ title: 'Unidad quitada', message: unit.name, tone: 'warning', icon: 'delete' });
    } catch (error) { notify({ title: 'Error de Firebase', message: error.message, tone: 'error' }); }
  };

  return (
    <section className="side-card">
      <div className="side-card__head">
        <h3 className="side-card__title">
          <Icon name="local_police" /> Unidades de guardia
        </h3>
        <span className="side-card__count num">
          {onDuty}/{units.length} en servicio
        </span>
      </div>

      <ul className="units">
        {units.map((u) => {
          const status = UNIT_STATUS[u.status] ?? UNIT_STATUS.disponible;
          return (
            <li key={u.id} className={`unit tone-${status.tone}`}>
              <span className="unit__dot" />
              <div className="unit__text">
                <strong>{u.name}</strong>
                <span className="soft">
                  {u.leader} · {SHIFTS[u.shift]} · {sectorName(u.sectorId)}
                </span>
              </div>
              <select
                className="unit__status"
                value={u.status}
                onChange={(e) => setStatus(u, e.target.value)}
                aria-label={`Estado de ${u.name}`}
              >
                {Object.entries(UNIT_STATUS).map(([value, s]) => (
                  <option key={value} value={value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button className="unit__edit" onClick={() => setEditing(u)} aria-label={`Editar ${u.name}`} title="Editar">
                <Icon name="edit" size={18} />
              </button>
            </li>
          );
        })}
      </ul>

      <Button variant="secondary" icon="add" onClick={() => setEditing({})}>
        Agregar unidad
      </Button>

      {editing && (
        <UnitForm unit={editing} sectors={sectors} onSave={save} onRemove={() => remove(editing)} onClose={() => setEditing(null)} />
      )}
    </section>
  );
}

/* ======================================================================
 * CONSOLA
 * ====================================================================== */
// --- modules/proteccion-civil/ConsolePage.jsx
/*
 * Consola táctica de Protección Civil.
 * Las guardias detectan riesgos para la población (derrumbe, gas, incendio, explosión, inundación);
 * aquí se registran como alertas y Protección Civil (o el admin de tandeo) las publica a la ciudadanía.
 */
function ConsolePage() {
  const { notify } = useToast();
  const [sectors, setSectors] = useState([]);
  const [alerts, setAlerts] = useState([]);
  const [units, setUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [allActivity, setAllActivity] = useState([]);
  const [activityLoading, setActivityLoading] = useState(true);
  const [activityError, setActivityError] = useState('');
  const [externalFocus, setExternalFocus] = useState(null);

  useEffect(() => {
    const reportError = (error) => notify({
      title: 'No se pudieron consultar los datos', message: error.message,
      tone: 'error', icon: 'error',
    });
    const offSectors = watchPcSectors(setSectors, reportError);
    const offAlerts = watchPcAlerts((items) => { setAlerts(items); setLoading(false); }, reportError);
    const offUnits = watchPcUnits(setUnits, reportError);
    const offActivity = watchArcaActivity(
      (items, done) => { setAllActivity(items); if (done) setActivityLoading(false); },
      (failure, name) => { setActivityError(`Colección ${name}: ${failure.message}`); setActivityLoading(false); }
    );
    return () => { offSectors(); offAlerts(); offUnits(); offActivity(); };
  }, []);
  const [zone, setZone] = useState('todas');
  const [selectedId, setSelectedId] = useState(() => alerts.find((a) => !a.closure)?.id ?? null);
  const [editing, setEditing] = useState(null); // alerta en el formulario ({} = nueva)

  const inZone = alerts.filter((a) => zone === 'todas' || a.sectorId === zone);
  const active = inZone.filter((a) => alertState(a) !== 'controlada');
  const critical = active.filter((a) => a.level === 'critico').length;
  const onDuty = units.filter((u) => u.status !== 'fuera').length;
  const selected = externalFocus ? null : (alerts.find((a) => a.id === selectedId) ?? alerts[0] ?? null);

  const saveAlert = async (alert) => {
    try {
      const savedId = await savePcAlert(alert);
      setSelectedId(savedId);
      notify({
        title: alert.id ? 'Alerta actualizada' : 'Alerta registrada',
        message: alert.id ? alert.colonia : 'Pendiente de publicación a la ciudadanía.',
        tone: 'success', icon: 'campaign',
      });
      setEditing(null);
    } catch (error) {
      notify({ title: 'No se guardó la alerta', message: error.message, tone: 'error', icon: 'error' });
    }
  };

  return (
    <div className="console">
      <div className="console__intro">
        <div>
          <h1>Consola táctica</h1>
          <p className="soft">Riesgos para la población detectados por las guardias de Protección Civil.</p>
        </div>
        <Button variant="alert" icon="add_alert" disabled={!sectors.some((sector) => sector.active !== false)} onClick={() => setEditing({})}>
          Nueva alerta de riesgo
        </Button>
      </div>

      {/* Zona y resumen */}
      <div className="console__toolbar">
        <div className="console__zones" role="tablist" aria-label="Zona">
          {[{ id: 'todas', name: 'Todas las zonas' }, ...sectors].map((s) => (
            <button key={s.id} role="tab" aria-selected={zone === s.id} className={zone === s.id ? 'is-active' : ''} onClick={() => setZone(s.id)}>
              {s.name}
            </button>
          ))}
        </div>
        <div className="console__summary">
          <span className="tone-warning">
            <span className="live-dot" /> <strong className="num">{active.length}</strong> alertas activas
          </span>
          <span className="tone-error">
            <strong className="num">{critical}</strong> críticas
          </span>
          <span>
            <Icon name="local_police" size={16} /> <strong className="num">{onDuty}</strong> unidades en servicio
          </span>
        </div>
      </div>

      {loading && <p className="pc-loading" role="status">Consultando alertas en Firebase…</p>}
      <ArcaActivityFeed
        items={allActivity}
        sectors={sectors}
        loading={activityLoading}
        error={activityError}
        onFocus={(position) => { setZone('todas'); setExternalFocus(position); }}
      />
      {!loading && !alerts.length && (
        <p className="pc-loading">Todavía no hay alertas propias de Protección Civil. Los registros de otros módulos aparecen arriba en «Actividad y alertas de ARCA».</p>
      )}
      <div className="console__grid">
        <AlertList alerts={inZone} sectors={sectors} selectedId={selectedId} onSelect={setSelectedId} />

        <div className="console__center">
          <RiskMap alerts={inZone} sectors={sectors} zone={zone} selected={selected} externalItems={allActivity} externalFocus={externalFocus} onSelectExternal={setExternalFocus} onSelect={(id) => { setExternalFocus(null); setSelectedId(id); }} />
          <AlertDetail
            alert={selected}
            sectors={sectors}
            onEdit={setEditing}
            onChange={setAlerts}
            onRemoved={() => setSelectedId(null)}
          />
        </div>

        <aside className="console__side">
          <SectorPanorama alerts={alerts} sectors={sectors} onZone={setZone} />
          <UnitsPanel units={units} sectors={sectors} onChange={setUnits} />
        </aside>
      </div>

      {editing && <AlertForm alert={editing} sectors={sectors} units={units} onSave={saveAlert} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ======================================================================
 * TEMA (claro / oscuro) Y PANTALLA COMPLETA
 * ====================================================================== */
// El tema vive en el contenedor .arca-pc, no en <html>, para no afectar al resto del proyecto.
const ThemeContext = createContext(null);
const useTheme = () => useContext(ThemeContext);

function initialTheme() {
  try {
    const saved = localStorage.getItem('arca-theme');
    if (saved) return saved;
  } catch {
    /* navegador sin almacenamiento */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
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

export default function ArcaProteccionCivil({ onLogout }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    try {
      localStorage.setItem('arca-theme', theme);
    } catch {
      /* sin almacenamiento: solo dura la sesión */
    }
  }, [theme]);

  useEffect(() => {
    document.body.classList.add('arca-pc-body');
    document.body.dataset.arcaPcTheme = theme;
    return () => {
      document.body.classList.remove('arca-pc-body');
      delete document.body.dataset.arcaPcTheme;
    };
  }, [theme]);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <ToastProvider>
        <div className="arca-pc" data-theme={theme}>
          <Header onLogout={onLogout} />
          <main style={{ paddingTop: 'var(--header-h)' }}>
            <ConsolePage />
          </main>
          <Toasts />
        </div>
      </ToastProvider>
    </ThemeContext.Provider>
  );
}
