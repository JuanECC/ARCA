/*
 * ARCA · Panel del administrador de cuadrillas de agua (todo el módulo en un archivo).
 * Estilos: ArcaCuadrillas.css (todo queda dentro de la clase .arca-cuadrillas).
 *
 * Uso:
 *   import ArcaCuadrillas from './ArcaCuadrillas';
 *   <ArcaCuadrillas />
 *
 * Datos: Firestore en tiempo real (systemReports, sectors, sectorCrews, workUpdates).
 */
import { createContext, useContext, useEffect, useState } from 'react';
import { CircleMarker, MapContainer, Popup, TileLayer, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { reportMapStatus } from '../reportMapStatus';
import './ArcaCuadrillas.css';
import {
  watchCrewSectors, watchAssignedJobs, watchSectorCrews, watchCrewCitizenReports,
  saveCrewMember, deleteCrewMember, startCrewJob, finishCrewJob, assignCitizenJob,
} from './cuadrillasService';


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
function photoToDataUrl(file, maxSize = 900, quality = 0.7) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      const imageData = canvas.toDataURL('image/jpeg', 0.52);
      if (imageData.length > 160000) reject(new Error('La foto supera 160 KB. Usa una imagen más pequeña.'));
      else resolve(imageData);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo leer la imagen'));
    };
    img.src = url;
  });
}

/* ======================================================================
 * FIRESTORE EN VIVO · SIN DATOS DEMO NI LOCALSTORAGE INSTITUCIONAL
 * ====================================================================== */

const REPORT_TYPES = {
  fuga: { label: 'Fuga de agua', icon: 'water_damage' },
  'sin-agua': { label: 'Sin suministro', icon: 'water_voc' },
  'baja-presion': { label: 'Baja presión', icon: 'speed' },
  drenaje: { label: 'Drenaje', icon: 'plumbing' },
  inundacion: { label: 'Inundación', icon: 'flood' },
  otro: { label: 'Otra falla', icon: 'build' },
};
const JOB_STATES = {
  'por-iniciar': { label: 'Por iniciar', tone: 'error' },
  'en-proceso': { label: '👷 En reparación', tone: 'warning' },
  terminado: { label: 'Terminado · espera revisión', tone: 'primary' },
  cerrado: { label: 'Ciudadanía avisada', tone: 'success' },
};
function jobState(job) {
  if (job.status === 'resuelto') return 'cerrado';
  if (job.status === 'terminado') return 'terminado';
  return job.assignment?.progress?.state === 'en-proceso' ? 'en-proceso' : 'por-iniciar';
}
const ROLES = {
  jefe: 'Jefe de cuadrilla', fontanero: 'Fontanero',
  valvulas: 'Operador de válvulas', ayudante: 'Ayudante',
};
const cuadrillasStore = {
  getSectors: () => currentSectors,
  saveMember: saveCrewMember,
  removeMember: deleteCrewMember,
  startJob: startCrewJob,
  finishJob: finishCrewJob,
};
let currentSectors = [];
const newId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
// Botón. variant: primary | secondary | danger | ghost
function Button({ variant = 'secondary', icon, children, ...props }) {
  return (
    <button type="button" className={`btn btn--${variant}`} {...props}>
      {icon && <Icon name={icon} size={18} />}
      {children}
    </button>
  );
}

// --- components/Card/Card.jsx
// Tarjeta de vidrio con título opcional.
function Card({ icon, title, aside, className = '', children }) {
  return (
    <section className={`card ${className}`}>
      {title && (
        <header className="card__header">
          <h3 className="card__title">
            {icon && <Icon name={icon} />}
            {title}
          </h3>
          {aside}
        </header>
      )}
      {children}
    </section>
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
// Barra superior del panel de cuadrillas.
function Header({ onLogout }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <header className="header">
      <div className="header__brand">
        <Logo />
        <div>
          <p className="header__name">
            ARCA <strong>Cuadrillas de Agua</strong>
          </p>
          <p className="header__tagline">Red de agua potable · Veracruz – Boca del Río</p>
        </div>
        <Badge tone="tertiary">Admin de cuadrillas</Badge>
      </div>

      <div className="crew-header-actions">
        <button type="button" className="header__theme" onClick={toggleTheme} aria-label="Cambiar tema">
          <Icon name={theme === 'dark' ? 'light_mode' : 'dark_mode'} />
        </button>
        {onLogout && <button type="button" onClick={onLogout} className="arca-logout">Cerrar sesión</button>}
      </div>
    </header>
  );
}

/* ======================================================================
 * TRABAJOS ASIGNADOS
 * ====================================================================== */
// --- modules/cuadrillas/jobs/PhotoPicker.jsx
const MAX_PHOTOS = 3;

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

// --- modules/cuadrillas/jobs/JobModals.jsx
// Iniciar un trabajo: se elige al responsable dentro de la cuadrilla del sector.
function StartJobModal({ job, members = [], onConfirm, onClose, sectors, crews }) {
  const [sectorId, setSectorId] = useState(sectors?.[0]?.id ?? '');
  const [memberId, setMemberId] = useState('');
  const selectedSector = sectors?.find(item => item.id === sectorId);
  const available = sectors ? (crews[sectorId]?.members ?? []) : members;
  const leaders = [...available].sort((a, b) => (a.role === 'jefe' ? -1 : b.role === 'jefe' ? 1 : 0));
  const member = leaders.find(item => item.id === memberId) ?? leaders[0];

  const submit = (e) => {
    e.preventDefault();
    if (member) onConfirm(sectors ? { sector: selectedSector, member } : member.name);
  };

  return (
    <Modal
      title="Iniciar trabajo"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon="play_arrow" type="submit" form="start-form" disabled={!member}>
            Iniciar
          </Button>
        </>
      }
    >
      <form id="start-form" className="modal__body-form" onSubmit={submit}>
        <p className="job-intro">
          <Icon name="engineering" size={18} />
          <span>
            {job.colonia} · el admin de tandeo verá que el trabajo está en proceso y quién es el responsable.
          </span>
        </p>
        {sectors && <label className="field">
          Sector de la cuadrilla
          <select className="input" value={sectorId} onChange={e => { setSectorId(e.target.value); setMemberId(''); }}>
            {sectors.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>}
        {leaders.length === 0 ? (
          <p className="job-error">Este sector no tiene integrantes. Agrégalos en la pestaña Cuadrillas.</p>
        ) : (
          <label className="field">
            Responsable del trabajo
            <select className="input" value={member.id} onChange={(e) => setMemberId(e.target.value)}>
              {leaders.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {ROLES[m.role] ?? m.role}
                </option>
              ))}
            </select>
          </label>
        )}
      </form>
    </Modal>
  );
}

// Terminar un trabajo: nota y fotos del trabajo hecho (obligatorias para que el admin lo verifique).
function FinishJobModal({ job, onConfirm, onClose }) {
  const [note, setNote] = useState('');
  const [photos, setPhotos] = useState([]);
  const [error, setError] = useState('');

  const submit = (e) => {
    e.preventDefault();
    if (!photos.length) return setError('Agrega al menos una foto del trabajo terminado: el admin de tandeo la usa para verificar.');
    onConfirm({ note: note.trim(), photos, by: job.assignment.progress?.leader ?? job.assignment.crew });
  };

  return (
    <Modal
      title="Marcar como terminado"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon="task_alt" type="submit" form="finish-form">
            Enviar al admin de tandeo
          </Button>
        </>
      }
    >
      <form id="finish-form" className="modal__body-form" onSubmit={submit}>
        <p className="job-intro">
          <Icon name="info" size={18} />
          <span>El admin de tandeo revisará el trabajo y avisará a la ciudadanía de {job.colonia}.</span>
        </p>
        <label className="field">
          ¿Qué trabajo se hizo?
          <textarea
            className="input"
            required
            maxLength={280}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Ej. Se cambió el tramo de tubería de 4 pulgadas y se revisó la presión."
          />
        </label>
        <div className="field">
          Fotos del trabajo terminado (obligatorio, hasta 3)
          <PhotoPicker
            photos={photos}
            onChange={(list) => {
              setPhotos(list);
              setError('');
            }}
          />
        </div>
        {error && (
          <p className="job-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </Modal>
  );
}

// Visor de fotos con miniaturas
function PhotoViewer({ photos, index, onIndex, onClose }) {
  return (
    <Modal title={`Foto ${index + 1} de ${photos.length}`} onClose={onClose}>
      <img className="job-photo" src={photos[index]} alt="Foto del reporte" />
      {photos.length > 1 && (
        <div className="job-photo__nav">
          {photos.map((src, i) => (
            <button
              key={i}
              className={i === index ? 'is-active' : ''}
              style={{ backgroundImage: `url(${src})` }}
              onClick={() => onIndex(i)}
              aria-label={`Ver foto ${i + 1}`}
            />
          ))}
        </div>
      )}
    </Modal>
  );
}

// --- modules/cuadrillas/jobs/JobCard.jsx
const STEPS = [
  { state: 'por-iniciar', label: 'Recibido' },
  { state: 'en-proceso', label: 'En proceso' },
  { state: 'terminado', label: 'Terminado' },
  { state: 'cerrado', label: 'Ciudadanía avisada' },
];

// Tarjeta de un trabajo: fotos del reporte, instrucciones del admin y la siguiente acción.
function JobCard({ job, sectorName, onStart, onFinish, onViewPhoto }) {
  const type = REPORT_TYPES[job.type] ?? REPORT_TYPES.otro;
  const stateId = jobState(job);
  const state = JOB_STATES[stateId];
  const step = STEPS.findIndex((s) => s.state === stateId);
  const photos = job.photos ?? [];

  return (
    <li className={`job tone-${state.tone}`}>
      <div className="job__photos">
        {photos.map((src, i) => (
          <button key={i} className="job__photo" style={{ backgroundImage: `url(${src})` }} onClick={() => onViewPhoto(photos, i)}>
            <span className="sr-only">Ver foto {i + 1}</span>
          </button>
        ))}
      </div>

      <div className="job__body">
        <div className="job__head">
          <span className="job__type">
            <Icon name={type.icon} size={18} />
          </span>
          <div className="job__title">
            <strong>{type.label}</strong>
            <span>{job.colonia}</span>
          </div>
          <Badge tone={state.tone}>{state.label}</Badge>
        </div>

        <div className="job__tags">
          <span className="job__tag">
            <Icon name="hub" size={14} /> {sectorName}
          </span>
          <span className="job__tag">
            <Icon name="groups" size={14} /> {job.assignment.crew}
          </span>
          <span className="job__tag">
            <Icon name="schedule" size={14} /> Asignado {timeAgo(job.assignment.at)}
          </span>
        </div>

        <p>{job.description}</p>

        {job.assignment.instructions && (
          <p className="job__note job__note--admin">
            <Icon name="assignment" size={16} />
            <span>
              <strong>Instrucciones del admin de tandeo:</strong> {job.assignment.instructions}
            </span>
          </p>
        )}

        <ol className="job-steps" aria-label="Avance del trabajo">
          {STEPS.map((s, i) => (
            <li key={s.state} className={i < step ? 'is-done' : i === step ? 'is-current' : ''}>
              <span className="job-steps__dot">{i < step ? <Icon name="check" size={12} /> : i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>

        {job.assignment.progress && (
          <p className="job__note">
            <Icon name="person" size={16} />
            <span>
              Responsable: <strong>{job.assignment.progress.leader}</strong> · inició {timeAgo(job.assignment.progress.at)}
            </span>
          </p>
        )}
        {job.workDone && (
          <p className="job__note">
            <Icon name="task_alt" size={16} />
            <span>
              “{job.workDone.note}” · {timeAgo(job.workDone.at)}
              {job.workDone.photos?.length > 0 && (
                <>
                  {' · '}
                  <button className="job__link" onClick={() => onViewPhoto(job.workDone.photos, 0)}>
                    Ver fotos del trabajo
                  </button>
                </>
              )}
            </span>
          </p>
        )}
        {stateId === 'terminado' && (
          <p className="job__note">
            <Icon name="hourglass_top" size={16} />
            <span>Listo para que el admin de tandeo avise a la ciudadanía del sector.</span>
          </p>
        )}

        {(stateId === 'por-iniciar' || stateId === 'en-proceso') && (
          <div className="job__actions">
            {stateId === 'por-iniciar' ? (
              <Button variant="primary" icon="play_arrow" onClick={onStart}>
                Iniciar trabajo
              </Button>
            ) : (
              <Button variant="primary" icon="task_alt" onClick={onFinish}>
                Marcar como terminado
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

// --- modules/cuadrillas/jobs/JobsTab.jsx
const FILTERS = [
  { id: 'activos', label: 'Por atender', match: (s) => s === 'por-iniciar' || s === 'en-proceso' },
  ...Object.entries(JOB_STATES).map(([id, s]) => ({ id, label: s.label, match: (state) => state === id })),
  { id: 'todos', label: 'Todos', match: () => true },
];

/*
 * Trabajos asignados. Flujo de la cuadrilla:
 * el admin de tandeo asigna → Iniciar trabajo (responsable) → Marcar como terminado (nota + fotos)
 * → el admin de tandeo avisa a la ciudadanía del sector.
 */
function FitReports({ positions }) {
  const map = useMap();
  return <button type="button" className="crew-map-fit" disabled={!positions.length}
    onClick={() => map.fitBounds(positions, { padding: [30, 30], maxZoom: 16 })}>Ver todos los puntos</button>;
}

function JobsTab({ jobs, crews, citizenReports }) {
  const { notify } = useToast();
  const sectors = cuadrillasStore.getSectors();
  const [filter, setFilter] = useState('activos');
  const [sector, setSector] = useState('todos');
  const [modal, setModal] = useState(null); // { kind: 'start' | 'finish' | 'photo', ... }

  const sectorName = (id) => sectors.find((s) => s.id === id)?.name ?? 'Sin sector';
  const inSector = jobs.filter((j) => sector === 'todos' || j.sectorId === sector);
  const assignedCitizenIds = new Set(jobs.map(job => job.citizenReportId));
  const unassignedReports = sector === 'todos' ? citizenReports.filter(report =>
    !assignedCitizenIds.has(report.id)
    && Number.isFinite(report.ubicacion?.lat) && Number.isFinite(report.ubicacion?.lng)
  ) : [];
  const match = FILTERS.find((f) => f.id === filter).match;
  const mappedJobs = inSector.filter(job => Number.isFinite(job.position?.lat) && Number.isFinite(job.position?.lng));
  const visible = inSector.filter((j) => match(jobState(j)));
  const close = () => setModal(null);

  const [busy, setBusy] = useState(false);
  const run = async (change, toast) => {
    if (busy) return;
    setBusy(true);
    try {
      await change();
      notify(toast);
      close();
    } catch (error) {
      notify({ title: 'No se pudo guardar en Firestore', message: error.message, tone: 'error', icon: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const start = (leader) =>
    run(() => cuadrillasStore.startJob(modal.job.id, leader), {
      title: '👷 Reparación iniciada',
      message: `${modal.job.colonia} · responsable: ${leader}`,
      tone: 'warning', icon: 'engineering',
    });

  const finish = (result) =>
    run(() => cuadrillasStore.finishJob(modal.job.id, result), {
      title: 'Trabajo terminado',
      message: 'Operaciones puede verificar y avisar a la ciudadanía.',
      tone: 'success', icon: 'task_alt',
    });

  return (
    <Card
      icon="engineering"
      title="Trabajos asignados"
      aside={
        <label className="jobs__sector">
          <Icon name="hub" size={18} />
          <select className="input" value={sector} onChange={(e) => setSector(e.target.value)} aria-label="Filtrar por sector">
            <option value="todos">Todos los sectores</option>
            {sectors.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      }
    >
      <MapContainer center={[19.176, -96.138]} zoom={12} scrollWheelZoom={false} className="crew-jobs-map" aria-label="Mapa de trabajos asignados">
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution="&copy; OpenStreetMap contributors" />
        {unassignedReports.map(report => (
          <CircleMarker key={`citizen:${report.id}`} center={[report.ubicacion.lat, report.ubicacion.lng]} radius={9}
            pathOptions={{ color: reportMapStatus(report.estado).color, fillOpacity: 0.85 }}>
            {report.estado === 'en-reparacion' && <Tooltip permanent direction="right" offset={[11, 0]}><span role="img" aria-label="En reparación">🔨</span></Tooltip>}
            <Popup>
              <strong>{report.titulo}</strong>
              <p>{report.descripcion}</p>
              {report.fotoBase64 && <img className="crew-map-photo" src={report.fotoBase64} alt="Fotografía original del reporte ciudadano" />}
              <p>{reportMapStatus(report.estado).label}</p>
              {report.estado === 'pendiente' && <Button onClick={() => setModal({ kind: 'assign-citizen', report })}>Asignar integrante</Button>}
            </Popup>
          </CircleMarker>
        ))}
        {mappedJobs.map(job => {
          const state = jobState(job);
          const status = reportMapStatus(state === 'en-proceso' ? 'en-reparacion' : job.status === 'terminado' ? 'reparado' : job.status);
          return (
            <CircleMarker key={job.id} center={[job.position.lat, job.position.lng]} radius={9}
              pathOptions={{ color: status.color, fillColor: status.color, fillOpacity: 0.85 }}>
              {status.hammer && <Tooltip permanent direction="right" offset={[11, 0]}><span role="img" aria-label="En reparación">🔨</span></Tooltip>}
              <Popup>
                <strong>{job.colonia}</strong>
                <p>{job.description}</p>
                {job.photos?.[0] && <img className="crew-map-photo" src={job.photos[0]} alt="Fotografía original del reporte" />}
                <p>{status.label}</p>
                {state === 'por-iniciar' && <Button onClick={() => setModal({ kind: 'start', job })}>Asignar integrante</Button>}
                {state === 'en-proceso' && <Button onClick={() => setModal({ kind: 'finish', job })}>Registrar reparación</Button>}
              </Popup>
            </CircleMarker>
          );
        })}
        <FitReports positions={[
          ...unassignedReports.map(report => [report.ubicacion.lat, report.ubicacion.lng]),
          ...mappedJobs.map(job => [job.position.lat, job.position.lng]),
        ]} />
      </MapContainer>
      <p className="soft">Azul: por atender · 🔨 Ámbar: en reparación · Verde: reparado</p>
      <div className="jobs__filters">
        {FILTERS.map((f) => (
          <button key={f.id} className={filter === f.id ? 'is-active' : ''} onClick={() => setFilter(f.id)}>
            {f.label} <span className="num">{inSector.filter((j) => f.match(jobState(j))).length}</span>
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p className="jobs__empty soft">
          <Icon name="inbox" /> No hay trabajos en esta sección.
        </p>
      ) : (
        <ul className="jobs">
          {visible.map((j) => (
            <JobCard
              key={j.id}
              job={j}
              sectorName={sectorName(j.sectorId)}
              onStart={() => setModal({ kind: 'start', job: j })}
              onFinish={() => setModal({ kind: 'finish', job: j })}
              onViewPhoto={(photos, index) => setModal({ kind: 'photo', photos, index })}
            />
          ))}
        </ul>
      )}

      {modal?.kind === 'start' && (
        <StartJobModal job={modal.job} members={crews[modal.job.sectorId]?.members ?? []} onConfirm={start} onClose={close} />
      )}
      {modal?.kind === 'assign-citizen' && (
        <StartJobModal job={{ colonia: modal.report.titulo }} sectors={sectors} crews={crews} onClose={close}
          onConfirm={({ sector: selected, member }) => run(
            () => assignCitizenJob(modal.report.id, selected, member),
            { title: 'Reparación iniciada', message: `Responsable: ${member.name}`, tone: 'success', icon: 'engineering' },
          )} />
      )}
      {modal?.kind === 'finish' && <FinishJobModal job={modal.job} onConfirm={finish} onClose={close} />}
      {modal?.kind === 'photo' && (
        <PhotoViewer photos={modal.photos} index={modal.index} onIndex={(index) => setModal({ ...modal, index })} onClose={close} />
      )}
    </Card>
  );
}

/* ======================================================================
 * CUADRILLAS
 * ====================================================================== */
// --- modules/cuadrillas/crews/MemberForm.jsx
// Alta o edición de un integrante de la cuadrilla.
function MemberForm({ member, onSave, onClose }) {
  const [form, setForm] = useState({ name: '', role: 'fontanero', ...member });

  const submit = (e) => {
    e.preventDefault();
    onSave({ ...form, name: form.name.trim() });
  };

  return (
    <Modal
      title={member.id ? 'Editar integrante' : 'Agregar integrante'}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button variant="primary" icon="save" type="submit" form="member-form">
            Guardar
          </Button>
        </>
      }
    >
      <form id="member-form" className="modal__body-form" onSubmit={submit}>
        <label className="field">
          Nombre
          <input className="input" required autoFocus maxLength={60} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <div className="field">
          Puesto
          <div className="choices">
            {Object.entries(ROLES).map(([value, label]) => (
              <label key={value} className="choice tone-primary">
                <input type="radio" name="role" value={value} checked={form.role === value} onChange={() => setForm({ ...form, role: value })} />
                {label}
              </label>
            ))}
          </div>
        </div>
      </form>
    </Modal>
  );
}

// --- modules/cuadrillas/crews/CrewsTab.jsx
// Una cuadrilla por sector: integrantes y cuántos trabajos tiene en curso.
function CrewsTab({ jobs, crews }) {
  const { notify } = useToast();
  const sectors = cuadrillasStore.getSectors().filter((s) => s.active !== false);
  const [editing, setEditing] = useState(null); // { sectorId, member }

  const save = async (member) => {
    try {
      await cuadrillasStore.saveMember(editing.sectorId, member);
      notify({ title: member.id ? 'Integrante actualizado' : 'Integrante agregado', message: member.name, tone: 'success', icon: 'person_add' });
      setEditing(null);
    } catch (error) {
      notify({ title: 'No se pudo guardar en Firestore', message: error.message, tone: 'error', icon: 'error' });
    }
  };

  const remove = async (sectorId, member) => {
    if (!window.confirm(`¿Quitar a ${member.name} de la cuadrilla?`)) return;
    try {
      await cuadrillasStore.removeMember(sectorId, member.id);
      notify({ title: 'Integrante quitado', message: member.name, tone: 'warning', icon: 'person_remove' });
    } catch (error) {
      notify({ title: 'No se pudo quitar', message: error.message, tone: 'error', icon: 'error' });
    }
  };

  return (
    <div className="crews">
      {sectors.map((s) => {
        const members = crews[s.id]?.members ?? [];
        const active = jobs.filter((j) => j.sectorId === s.id && ['por-iniciar', 'en-proceso'].includes(jobState(j))).length;
        return (
          <section key={s.id} className="crew">
            <header className="crew__head">
              <span className="crew__icon">
                <Icon name="groups" />
              </span>
              <div className="crew__title">
                <h3>Cuadrilla {s.name}</h3>
                <p className="soft">{s.colonias}</p>
              </div>
              <Badge tone={active ? 'warning' : 'success'}>{active ? `${active} en curso` : 'Disponible'}</Badge>
            </header>

            {members.length === 0 && <p className="soft crew__empty">Sin integrantes todavía.</p>}

            <ul className="crew__members">
              {members.map((m) => (
                <li key={m.id}>
                  <Icon name={m.role === 'jefe' ? 'shield_person' : 'person'} size={18} />
                  <div>
                    <strong>{m.name}</strong>
                    <span className="soft">{ROLES[m.role] ?? m.role}</span>
                  </div>
                  <button onClick={() => setEditing({ sectorId: s.id, member: m })} aria-label={`Editar ${m.name}`} title="Editar">
                    <Icon name="edit" size={18} />
                  </button>
                  <button onClick={() => remove(s.id, m)} aria-label={`Quitar ${m.name}`} title="Quitar">
                    <Icon name="person_remove" size={18} />
                  </button>
                </li>
              ))}
            </ul>

            <Button variant="secondary" icon="person_add" onClick={() => setEditing({ sectorId: s.id, member: {} })}>
              Agregar integrante
            </Button>
          </section>
        );
      })}

      {editing && <MemberForm member={editing.member} onSave={save} onClose={() => setEditing(null)} />}
    </div>
  );
}

/* ======================================================================
 * PANTALLA DE CUADRILLAS
 * ====================================================================== */
// --- modules/cuadrillas/CuadrillasPage.jsx
// Panel de cuadrillas: trabajos que asigna el admin de tandeo y los integrantes de cada cuadrilla.
function CuadrillasPage() {
  const [tab, setTab] = useState('jobs');
  const [jobs, setJobs] = useState([]);
  const [citizenReports, setCitizenReports] = useState([]);
  const [crews, setCrews] = useState({});
  const [sectors, setSectors] = useState([]);
  const [liveError, setLiveError] = useState('');
  useEffect(() => {
    const onError = (error) => setLiveError(error?.code === 'permission-denied'
      ? 'Tu cuenta no tiene acceso a los datos de Cuadrillas.'
      : 'No se pudieron cargar los datos de Cuadrillas.');
    const unsubs = [
      watchCrewSectors((items) => { currentSectors = items; setSectors(items); }, onError),
      watchAssignedJobs(setJobs, onError),
      watchCrewCitizenReports(setCitizenReports, onError),
      watchSectorCrews(setCrews, onError),
    ];
    return () => unsubs.forEach((unsubscribe) => unsubscribe?.());
  }, []);

  const pending = jobs.filter((j) => jobState(j) === 'por-iniciar').length;
  const tabs = [
    { id: 'jobs', icon: 'engineering', label: 'Trabajos asignados', count: pending },
    { id: 'crews', icon: 'groups', label: 'Cuadrillas' },
  ];

  return (
    <div className="admin">
      <div className="admin__intro">
        <h1>Cuadrillas de agua</h1>
        <p className="soft">Trabajos que asigna el administrador de tandeo a la cuadrilla de cada sector.</p>
      </div>

      <nav className="admin__tabs" aria-label="Secciones">
        {tabs.map((t) => (
          <button key={t.id} className={tab === t.id ? 'is-active' : ''} onClick={() => setTab(t.id)}>
            <Icon name={t.icon} size={18} />
            {t.label}
            {t.count > 0 && <span className="admin__count num">{t.count}</span>}
          </button>
        ))}
      </nav>

      {liveError && <p role="alert" className="job-error">{liveError}</p>}
      {!sectors.length && !liveError && <p className="soft">Cargando sectores desde Firebase...</p>}
      {tab === 'jobs' && <JobsTab jobs={jobs} crews={crews} citizenReports={citizenReports} />}
      {tab === 'crews' && <CrewsTab jobs={jobs} crews={crews} />}
    </div>
  );
}

/* ======================================================================
 * TEMA (claro / oscuro) Y PANTALLA COMPLETA
 * ====================================================================== */
// El tema vive en el contenedor .arca-cuadrillas, no en <html>, para no afectar al resto del proyecto.
const ThemeContext = createContext(null);
const useTheme = () => useContext(ThemeContext);

function initialTheme() {
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

export default function ArcaCuadrillas({ onLogout }) {
  const [theme, setTheme] = useState(initialTheme);

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <ToastProvider>
        <div className="arca-cuadrillas" data-theme={theme}>
          <Header onLogout={onLogout} />
          <CuadrillasPage />
          <Toasts />
        </div>
      </ToastProvider>
    </ThemeContext.Provider>
  );
}
