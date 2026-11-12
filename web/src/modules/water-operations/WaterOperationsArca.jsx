import { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './ArcaTandeoAdmin.css';
import './WaterOperationsArca.css';
import {
  watchSectors, watchSchedule, watchNotices, watchSystemReports, watchSectorStatus,
  watchCitizenReports, saveSector, setSectorActive, saveDay, removeDay,
  saveOperationalReport, incorporateCitizenReport, assignWork, markWorkDone,
  resolveAndNotify, publishSectorNotice, publishRiskFromReport,
} from './tandeoService';

const TYPES = [
  ['fuga', 'Fuga de agua'], ['sin-agua', 'Sin suministro'], ['baja-presion', 'Baja presión'],
  ['drenaje', 'Drenaje'], ['otro', 'Otro problema'],
];
const TXT = { continuo: 'Continuo', parcial: 'Parcial', corte: 'Corte' };
const MAX_TRIES = 3;
const guard = { attempts: 0, lockedUntil: 0 };
const blankReport = { sectorId: '', type: 'fuga', colonia: '', description: '', photo: '', position: null };
const DAY_MS = 86400000;
const pad = (n) => String(n).padStart(2, '0');
const keyAt = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
const fmt = (value) => value?.toDate ? value.toDate().toLocaleString('es-MX') : (value ? new Date(value).toLocaleString('es-MX') : 'Sin fecha');
const clock = (value) => { const [hour, minute] = String(value || '00:00').split(':').map(Number); return hour * 60 + minute; };
const isLocked = (dateKey, entry) => {
  const start = new Date(`${dateKey}T${entry?.status === 'parcial' ? entry?.from || '00:00' : '00:00'}:00`);
  return start.getTime() - Date.now() < 3 * 60 * 60 * 1000;
};
const dateLabel = (date) => date.toLocaleString('es-MX', { month: 'long', year: 'numeric' });

function MapClick({ onChange }) { useMapEvents({ click: (event) => onChange({ lat: event.latlng.lat, lng: event.latlng.lng }) }); return null; }
function LocationPicker({ value, onChange }) {
  return <div className="wo-picker">
    <MapContainer center={[19.176, -96.138]} zoom={12} scrollWheelZoom={false} style={{ height: 260, width: '100%' }}>
      <TileLayer attribution='&copy; OpenStreetMap contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
      <MapClick onChange={onChange} />
      {value && <CircleMarker center={[value.lat, value.lng]} radius={9} pathOptions={{ color: '#00799b', fillOpacity: 0.8 }} />}
    </MapContainer>
    <small>{value ? `Ubicación seleccionada: ${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}` : 'Haz clic en el mapa para seleccionar la ubicación de la incidencia.'}</small>
  </div>;
}
function LayoutCard({ title, children, right }) {
  return <section className="wo-card"><div className="wo-cardhead"><h2>{title}</h2>{right}</div>{children}</section>;
}
function Feedback({ message }) { return message ? <div role="status" className="wo-feedback">{message}</div> : null; }
async function toWebp(file) {
  if (!file?.type?.startsWith('image/')) throw Error('Selecciona una imagen válida.');
  const image = await createImageBitmap(file);
  try {
    let width = Math.min(900, image.width), height = Math.round(image.height * width / image.width);
    for (const [maxWidth, quality] of [[900, 0.7], [750, 0.58], [600, 0.48], [450, 0.38]]) {
      width = Math.min(maxWidth, image.width); height = Math.max(1, Math.round(image.height * width / image.width));
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').drawImage(image, 0, 0, width, height);
      const result = canvas.toDataURL('image/webp', quality);
      if (result.startsWith('data:image/webp;base64,') && result.length <= 170000) return result;
    }
    throw Error('La imagen es demasiado pesada, utiliza una fotografía más pequeña.');
  } finally { image.close(); }
}
function SectorTab({ sectors }) {
  const [selected, setSelected] = useState('');
  const [editing, setEditing] = useState({ name: '', colonias: '' });
  const [search, setSearch] = useState('');
  const [pending, setPending] = useState(null);
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const [nowTick, setNowTick] = useState(Date.now());
  const [busy, setBusy] = useState(false);
  useEffect(() => { const id = setInterval(() => setNowTick(Date.now()), 1000); return () => clearInterval(id); }, []);
  const act = async (fn) => { setBusy(true); setNotice(''); try { await fn(); setNotice('Cambios guardados en Firebase.'); } catch (e) { setNotice(e.message); } finally { setBusy(false); } };
  const found = sectors.filter((s) => `${s.name} ${s.colonias}`.toLowerCase().includes(search.toLowerCase()));
  return <div className="wo-grid">
    <LayoutCard title="Sectores de agua">
      <input className="wo-input" placeholder="Buscar sector o colonia" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="wo-sectorlist">{found.map((s) => <div key={s.id} className="wo-sector">
        <button type="button" onClick={() => setSelected(s.id)} className={selected === s.id ? 'wo-link active' : 'wo-link'}>
          <strong>{s.name}</strong><small>{s.colonias}</small>
        </button>
        <button className="wo-small" onClick={() => setEditing({ ...s })}>Editar</button>
        <button className="wo-small" onClick={() => { setPassword(''); setPending(s); }}>{s.active === false ? 'Activar' : 'Desactivar'}</button>
      </div>)}</div>
      {!found.length && <p>No hay sectores. Crea el primero para comenzar.</p>}
      <button className="wo-button secondary" onClick={() => setEditing({ name: '', colonias: '' })}>+ Nuevo sector</button>
      <form className="wo-form" onSubmit={(e) => { e.preventDefault(); act(() => saveSector(editing)); }}>
        <label>Nombre del sector<input className="wo-input" required value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></label>
        <label>Colonias que abastece<input className="wo-input" required placeholder="Ej. Centro, Reforma, Zaragoza" value={editing.colonias} onChange={(e) => setEditing({ ...editing, colonias: e.target.value })} /></label>
        <button className="wo-button" disabled={busy}>Guardar sector</button>
      </form>
      <Feedback message={notice} />
    </LayoutCard>
    <MonthSchedule sectors={sectors} selected={selected} onSelected={setSelected} />
    {pending && <div className="wo-overlay"><div className="wo-dialog" role="dialog" aria-modal="true" aria-label="Confirmar sector">
      <h2>{pending.active === false ? 'Activar' : 'Desactivar'} {pending.name}</h2>
      <p>¿Seguro? Los sectores desactivados no deben mostrarse a la ciudadanía.</p>
      <label>Contraseña de confirmación<input type="password" className="wo-input" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
      {guard.lockedUntil > nowTick && <p>Bloqueado {Math.ceil((guard.lockedUntil - nowTick) / 1000)} segundos.</p>}
      <div className="wo-actions"><button onClick={() => setPending(null)} className="wo-button secondary">Cancelar</button>
        <button className="wo-button" disabled={guard.lockedUntil > nowTick || busy} onClick={() => {
          if (password !== 'arca2026') {
            guard.attempts += 1; setPassword('');
            if (guard.attempts >= MAX_TRIES) { guard.lockedUntil = Date.now() + 30000; guard.attempts = 0; }
            setNotice('Contraseña incorrecta.'); return;
          }
          guard.attempts = 0;
          act(async () => { await setSectorActive(pending.id, pending.active === false); setPending(null); });
        }}>Confirmar</button></div>
      <small>Esta contraseña es una confirmación de interfaz. La seguridad efectiva está en las reglas por rol de Firestore.</small>
    </div></div>}
  </div>;
}
function MonthSchedule({ sectors, selected, onSelected }) {
  const [days, setDays] = useState([]);
  const [month, setMonth] = useState(() => new Date());
  const [edit, setEdit] = useState(null);
  const [message, setMessage] = useState('');
  useEffect(() => watchSchedule(setDays, (e) => setMessage(e.message)), []);
  useEffect(() => { if (!selected && sectors.length) onSelected(sectors[0].id); }, [sectors, selected, onSelected]);
  const sector = sectors.find((s) => s.id === selected);
  const year = month.getFullYear(), mo = month.getMonth();
  const firstWeekday = (new Date(year, mo, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(year, mo + 1, 0).getDate();
  const byDate = new Map(days.filter((x) => x.sectorId === selected).map((x) => [x.fecha, x]));
  const grid = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, i) => i + 1)];
  const selectedDay = edit && byDate.get(edit);
  const locked = edit ? isLocked(edit, selectedDay) : false;
  const [form, setForm] = useState({ status: 'continuo', from: '06:00', to: '14:00', note: '' });
  const showDay = (key) => { const item = byDate.get(key); setForm({ status: item?.status || 'continuo', from: item?.from || '06:00', to: item?.to || '14:00', note: item?.note || '' }); setEdit(key); };
  const save = async (e) => { e.preventDefault(); try { await saveDay(selected, edit, form); setEdit(null); setMessage('Calendario guardado.'); } catch (error) { setMessage(error.message); } };
  return <LayoutCard title="Calendario mensual de tandeo" right={<select className="wo-input" value={selected} onChange={(e) => onSelected(e.target.value)}>{sectors.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>}>
    <div className="wo-monthhead"><button className="wo-small" onClick={() => setMonth(new Date(year, mo - 1, 1))}>‹ Mes anterior</button><strong>{dateLabel(month)}</strong><button className="wo-small" onClick={() => setMonth(new Date(year, mo + 1, 1))}>Mes siguiente ›</button></div>
    <div className="wo-calendar">{['L', 'M', 'M', 'J', 'V', 'S', 'D'].map((v, i) => <b key={i}>{v}</b>)}
      {grid.map((n, i) => n == null ? <span key={`empty-${i}`} /> : (() => {
        const key = keyAt(year, mo, n); const d = byDate.get(key);
        return <button key={key} className={`wo-day ${d?.status || 'empty'} ${isLocked(key, d) ? 'locked' : ''}`} title={d?.note || 'Sin programación'} onClick={() => showDay(key)}><strong>{n}</strong><small>{d ? TXT[d.status] : 'Sin dato'}</small></button>;
      })())}</div>
    <small>Los días sin programación se muestran como “Sin dato”; no se asume suministro continuo.</small>
    {edit && <div className="wo-overlay"><div className="wo-dialog" role="dialog" aria-modal="true" aria-label="Editar día">
      <h2>{edit} · {sector?.name}</h2>
      {locked ? <p>Este día está bloqueado: es pasado, el suministro ya empezó o faltan menos de tres horas. Solo lectura.</p> : null}
      <form className="wo-form" onSubmit={save}>
        <label>Tipo de suministro<select className="wo-input" value={form.status} disabled={locked} onChange={(e) => setForm({ ...form, status: e.target.value })}><option value="continuo">Continuo</option><option value="parcial">Parcial</option><option value="corte">Corte</option></select></label>
        {form.status === 'parcial' && <div className="wo-2"><label>Desde<input className="wo-input" type="time" disabled={locked} value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} /></label><label>Hasta<input className="wo-input" type="time" disabled={locked} value={form.to} onChange={(e) => setForm({ ...form, to: e.target.value })} /></label></div>}
        <label>Nota para ciudadanía<textarea className="wo-input" disabled={locked} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} maxLength={400}/></label>
        <div className="wo-actions"><button className="wo-button secondary" type="button" onClick={() => setEdit(null)}>Cerrar</button>
          {!locked && selectedDay && <button className="wo-button secondary" type="button" onClick={async () => { try { await removeDay(selected, edit); setEdit(null); } catch (error) { setMessage(error.message); } }}>Quitar programación</button>}
          {!locked && <button className="wo-button">Guardar día</button>}</div>
      </form>
    </div></div>}
    <Feedback message={message}/>
  </LayoutCard>;
}
function ReportsTab({ sectors, reports, citizens, status, operatorName }) {
  const [form, setForm] = useState(blankReport);
  const [sourceFilter, setSourceFilter] = useState('todos');
  const [sectorForCitizen, setSectorForCitizen] = useState({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const sectorName = (id) => sectors.find((s) => s.id === id)?.name || 'Sector no asignado';
  const work = async (fn) => { setBusy(true); setMessage(''); try { await fn(); setMessage('Acción registrada en Firebase.'); } catch (e) { setMessage(e.message); } finally { setBusy(false); } };
  const open = reports.filter((r) => ['asignado', 'terminado'].includes(r.status));
  const imported = new Set(reports.map((r) => r.citizenReportId).filter(Boolean));
  const unseen = citizens.filter((r) => ['fuga','drenaje'].includes(r.tipo) && !imported.has(r.id));
  const photos = reports.filter((r) => sourceFilter === 'todos' || r.source === sourceFilter);
  return <div className="wo-stack">
    <LayoutCard title="Registrar incidencia desde Operaciones" right={<span className="wo-chip">Departamento de Operaciones · {operatorName}</span>}>
      <form className="wo-form" onSubmit={(e) => { e.preventDefault(); work(async () => { await saveOperationalReport({ ...form, reporterName: operatorName }); setForm(blankReport); }); }}>
        <div className="wo-2"><label>Sector<select className="wo-input" required value={form.sectorId} onChange={(e) => setForm({ ...form, sectorId: e.target.value })}><option value="">Seleccionar sector</option>{sectors.filter((s) => s.active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        <label>Tipo de problema<select className="wo-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>{TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <label>Colonia o referencia<input className="wo-input" required minLength={3} value={form.colonia} onChange={(e) => setForm({ ...form, colonia: e.target.value })}/></label>
        <label>Descripción<textarea className="wo-input" required minLength={10} maxLength={1500} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}/></label>
        <label>Fotografía obligatoria (se comprime para Firestore)<input className="wo-input" type="file" accept="image/*" required={!form.photo} onChange={async (e) => { try { const photo = await toWebp(e.target.files[0]); setForm((f) => ({ ...f, photo })); } catch (error) { setMessage(error.message); } }}/></label>
        {form.photo && <img className="wo-photo" src={form.photo} alt="Fotografía preparada para el reporte" />}
        <label>Selecciona la ubicación en el mapa</label><LocationPicker value={form.position} onChange={(position) => setForm((f) => ({ ...f, position }))}/>
        <button className="wo-button" disabled={busy || !form.position || !form.photo}>Guardar incidencia</button>
      </form>
    </LayoutCard>
    <LayoutCard title={`Bandeja ciudadana · ${unseen.length} sin incorporar`}>
      <p>Reportes reales de fallas de agua (fugas y drenajes) de la colección <code>reportes</code>. Para enviarlos a la cuadrilla se asignan a un sector del calendario. Los originales no se modifican.</p>
      <div className="wo-reportgrid">{unseen.map((r) => <article className="wo-report" key={r.id}>
        <strong>{r.titulo || r.tipo}</strong><small>{r.autorNombre || 'Ciudadanía'} · {fmt(r.creadoEn)}</small>
        <p>{r.descripcion}</p>{r.fotoBase64 && <img className="wo-photo" src={r.fotoBase64} alt="Evidencia ciudadana" />}
        <div className="wo-actions"><select className="wo-input" value={sectorForCitizen[r.id] || ''} onChange={(e) => setSectorForCitizen({ ...sectorForCitizen, [r.id]: e.target.value })}><option value="">Selecciona sector</option>{sectors.filter((s) => s.active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
        <button className="wo-button" disabled={!r.fotoBase64 || !sectorForCitizen[r.id] || busy} onClick={() => work(() => incorporateCitizenReport(r, sectorForCitizen[r.id]))}>Asignar a Operaciones</button></div>
        {!r.fotoBase64 && <small>El reporte no tiene evidencia fotográfica; no puede incorporarse al flujo que exige fotografía.</small>}
      </article>)}</div>
    </LayoutCard>
    <LayoutCard title="Trabajos y reportes del sistema" right={<select className="wo-input" value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}><option value="todos">Todos</option><option value="ciudadano">Ciudadanía</option><option value="operaciones">Operaciones</option><option value="proteccion-civil">Protección Civil</option></select>}>
      <div className="wo-statrow">{sectors.filter((s) => s.active !== false).map((s) => <div key={s.id} className="wo-status"><strong>{s.name}</strong><small>{status.find((v) => v.id === s.id)?.state === 'reparacion' ? 'En reparación' : 'Normal'}</small><small>{reports.filter((r) => r.sectorId === s.id).length} reportes</small></div>)}</div>
      <div className="wo-reportgrid">{photos.map((r) => {
        const idx = ['nuevo', 'asignado', 'terminado', 'resuelto'].indexOf(r.status);
        return <article key={r.id} className="wo-report"><div className="wo-reporttop"><strong>{TYPES.find(([type]) => type === r.type)?.[1] || r.type}</strong><span className="wo-chip">{r.status}</span></div>
          <small>{sectorName(r.sectorId)} · {r.colonia}</small><small>Emisor: {r.reporter} · {fmt(r.creadoEn)}</small>
          <p>{r.description}</p>{r.photos?.[0] && <img className="wo-photo" src={r.photos[0]} alt="Evidencia de incidencia" />}
          <div className="wo-progress"><span style={{ width: `${Math.max(5, (idx + 1) / 4 * 100)}%` }} /></div>
          {r.assignment && <small>Asignado: {r.assignment.crew} · {r.assignment.instructions}</small>}
          {r.workDone && <small>Trabajo terminado: {r.workDone.note}</small>}
          <div className="wo-actions">
            {r.source !== 'proteccion-civil' && r.status === 'nuevo' && <button className="wo-button" disabled={busy} onClick={() => { const instructions = prompt('Instrucciones para la cuadrilla de este sector:') ?? null; if (instructions !== null) work(() => assignWork(r, instructions, sectorName(r.sectorId))); }}>Asignar trabajo</button>}
            {r.status === 'asignado' && <span className="wo-chip">Esperando a cuadrilla</span>}
            {r.status === 'terminado' && <button className="wo-button" disabled={busy} onClick={() => { const text = prompt('Aviso de restablecimiento para la ciudadanía:'); if (text) work(() => resolveAndNotify(r, text, open, operatorName)); }}>Actualizar y notificar</button>}
            {r.source === 'proteccion-civil' && r.status === 'nuevo' && <button className="wo-button" disabled={busy} onClick={() => { if (confirm('¿Publicar alerta a toda la ciudadanía?')) work(() => publishRiskFromReport(r, operatorName)); }}>Publicar alerta general</button>}
          </div>
        </article>;
      })}</div>
    </LayoutCard>
    <Feedback message={message}/>
  </div>;
}
function NoticesTab({ sectors, notices, name }) {
  const [input, setInput] = useState({ sectorId: '', title: '', message: '', kind: 'tandeo', audience: 'sector', level: 'info', position: null });
  const [message, setMessage] = useState('');
  return <div className="wo-grid"><LayoutCard title="Publicar aviso de tandeo">
    <form className="wo-form" onSubmit={async (e) => { e.preventDefault(); try { await publishSectorNotice(input, name); setInput({ ...input, title: '', message: '', position: null }); setMessage('Aviso publicado y disponible en tiempo real.'); } catch (error) { setMessage(error.message); } }}>
      <label>Sector afectado<select required className="wo-input" value={input.sectorId} onChange={(e) => setInput({ ...input, sectorId: e.target.value })}><option value="">Seleccionar sector</option>{sectors.filter((s) => s.active !== false).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label>Título<input required minLength={5} maxLength={100} className="wo-input" value={input.title} onChange={(e) => setInput({ ...input, title: e.target.value })}/></label>
      <label>Mensaje para ciudadanía<textarea required minLength={10} maxLength={500} className="wo-input" value={input.message} onChange={(e) => setInput({ ...input, message: e.target.value })}/></label>
      <label>Ubicación del aviso (opcional)</label><LocationPicker value={input.position} onChange={(position) => setInput((v) => ({ ...v, position }))}/>
      <button className="wo-button">Publicar aviso</button>
      <Feedback message={message}/>
    </form></LayoutCard>
    <LayoutCard title="Avisos publicados">{notices.map((n) => <div className="wo-notice" key={n.id}><strong>{n.title}</strong><p>{n.message}</p><small>Departamento de Operaciones / {n.reporter} · {fmt(n.creadoEn)}</small></div>)}</LayoutCard>
  </div>;
}
function StatsTab({ reports, notices, sectors }) {
  const [analysis, setAnalysis] = useState('');
  const [loadingAnalysis, setLoadingAnalysis] = useState(false);
  const byType = TYPES.map(([type, name]) => ({ type, name, count: reports.filter((r) => r.type === type).length })).filter((v) => v.count);
  const open = reports.filter((r) => !['resuelto', 'publicado'].includes(r.status)).length;
  const noticesWithDuration = reports.filter(r => r.notice?.at && r.creadoEn?.toDate?.());
  const avgHours = noticesWithDuration.length ? (noticesWithDuration.reduce((sum,r) => sum + Math.max(0,(new Date(r.notice.at) - r.creadoEn.toDate()) / 3600000),0)/noticesWithDuration.length).toFixed(1) : '—';
  const last24 = reports.filter((r) => {
    const created = r.creadoEn?.toDate?.() || new Date(r.createdAt || 0);
    return created > new Date(Date.now() - DAY_MS);
  }).length;
  return <div className="wo-stack"><div className="wo-statrow"><div className="wo-status"><strong>Reportes totales</strong><b>{reports.length}</b></div><div className="wo-status"><strong>Abiertos</strong><b>{open}</b></div><div className="wo-status"><strong>Últimas 24 h</strong><b>{last24}</b></div><div className="wo-status"><strong>Avisos publicados</strong><b>{notices.length}</b></div><div className="wo-status"><strong>Horas hasta notificar (prom.)</strong><b>{avgHours}</b></div></div>
    <LayoutCard title="Incidencias por tipo">{byType.map((v) => <div key={v.type} className="wo-bars"><span>{v.name}</span><div><span style={{ width: `${v.count / Math.max(1, reports.length) * 100}%` }}/></div><b>{v.count}</b></div>)}</LayoutCard>
    <LayoutCard title="Incidencias por sector">{sectors.map((s) => <div key={s.id} className="wo-bars"><span>{s.name}</span><div><span style={{ width: `${reports.filter((r) => r.sectorId === s.id).length / Math.max(1, reports.length) * 100}%` }}/></div><b>{reports.filter((r) => r.sectorId === s.id).length}</b></div>)}</LayoutCard>
    <LayoutCard title="Análisis de operación">
      <button className="wo-button" disabled={loadingAnalysis} onClick={async () => {
        setLoadingAnalysis(true);
        const stats = { reportes: reports.length, abiertos: open, ultimas24h: last24, horasHastaAvisar: avgHours, porTipo: byType, porSector: sectors.map(s => ({ sector: s.name, cantidad: reports.filter(r=>r.sectorId===s.id).length })) };
        try {
          const res = await fetch('/api/ia/analisis', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ stats }) });
          if (!res.ok) throw Error('Servidor de IA no disponible');
          const data = await res.json();
          setAnalysis(typeof data.resumen === 'string' ? data.resumen : JSON.stringify(data));
        } catch {
          setAnalysis(`Resumen automático (sin IA): se registraron ${reports.length} reportes, ${open} siguen abiertos y ${last24} llegaron en las últimas 24 horas. Sector con más reportes: ${[...sectors].sort((a,b)=>reports.filter(r=>r.sectorId===b.id).length - reports.filter(r=>r.sectorId===a.id).length)[0]?.name || 'ninguno'}.`);
        } finally { setLoadingAnalysis(false); }
      }}>{loadingAnalysis ? 'Generando…' : 'Generar análisis'}</button>
      {analysis && <p>{analysis}</p>}
      <small>El endpoint /api/ia/analisis requiere un servidor seguro. Si no está configurado, aparece un resumen local de los datos reales.</small>
    </LayoutCard>
  </div>;
}
export default function WaterOperationsArca({ profile, onLogout }) {
  const [theme, setTheme] = useState(() => {
    try { return localStorage.getItem('arca-water-theme') === 'dark' ? 'dark' : 'light'; }
    catch { return 'light'; }
  });
  useEffect(() => {
    try { localStorage.setItem('arca-water-theme', theme); } catch {}
    document.body.classList.toggle('arca-water-dark', theme === 'dark');
    return () => document.body.classList.remove('arca-water-dark');
  }, [theme]);
  const [tab, setTab] = useState('calendar');
  const [sectors, setSectors] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [reports, setReports] = useState([]);
  const [citizens, setCitizens] = useState([]);
  const [notices, setNotices] = useState([]);
  const [status, setStatus] = useState([]);
  const [error, setError] = useState('');
  const [floatingNotice, setFloatingNotice] = useState('');
  const seenCitizen = useRef(null);
  useEffect(() => {
    const ids = new Set(citizens.map(c => c.id));
    if (seenCitizen.current) {
      const incoming = citizens.find(c => !seenCitizen.current.has(c.id));
      if (incoming) setFloatingNotice(`Nuevo reporte ciudadano: ${incoming.titulo || incoming.tipo}`);
    }
    seenCitizen.current = ids;
  }, [citizens]);
  useEffect(() => {
    const err = (e) => setError(e?.message || 'No se pueden leer los datos. Revisa las reglas de Firestore.');
    const unsubs = [watchSectors(setSectors, err), watchSchedule(setSchedule, err), watchSystemReports(setReports, err),
      watchCitizenReports(setCitizens, err), watchNotices(setNotices, err), watchSectorStatus(setStatus, err)];
    return () => unsubs.forEach((fn) => fn?.());
  }, []);
  // Firestore sincroniza los datos entre operadores y ciudadanía.
  const name = profile?.nombre || 'Operador';
  return <div className="arca-admin wo-root" data-theme={theme}>
    <header className="wo-header">
      <div className="wo-brand">
        <span className="wo-brandmark" aria-hidden="true">💧</span>
        <div><strong>HidroAlerta <span>ARCA</span></strong><small>Red y Tandeo de Agua · Veracruz — Boca del Río</small></div>
        <span className="wo-live"><span aria-hidden="true" /> Datos en tiempo real</span>
      </div>
      <div className="wo-head-actions">
        <span className="wo-department">Departamento de Operaciones</span>
        <button className="wo-theme-toggle" type="button" aria-label={theme === 'light' ? 'Activar modo oscuro' : 'Activar modo claro'} title={theme === 'light' ? 'Modo oscuro' : 'Modo claro'} onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}>{theme === 'light' ? '☾' : '☀'}</button>
        {typeof onLogout === 'function' && <button className="wo-logout" type="button" onClick={onLogout}><span aria-hidden="true">⇥</span> Salir</button>}
      </div>
    </header>
    <main className="wo-main"><div className="wo-intro"><div><span className="wo-kicker">GESTIÓN DEL SUMINISTRO · VERACRUZ</span><h1>Administrador de Red y Tandeo</h1><p>Gestiona sectores, programa el suministro y da seguimiento a las incidencias desde un solo lugar.</p></div><div className="wo-intro-count"><strong>{sectors.filter((s) => s.active !== false).length}</strong><small>sectores activos</small></div></div>
      {error && <div className="wo-feedback wo-error">{error}</div>}
      <nav className="wo-tabs" aria-label="Pestañas de operaciones">{[['calendar','Calendario de tandeo'],['reports','Reportes del sistema'],['notices','Avisos'],['stats','Estadísticas']].map(([id, title]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)}>{title}</button>)}</nav>
      {tab === 'calendar' && <SectorTab sectors={sectors}/>}
      {tab === 'reports' && <ReportsTab sectors={sectors} reports={reports} citizens={citizens} status={status} operatorName={name}/>}
      {tab === 'notices' && <NoticesTab sectors={sectors} notices={notices} name={name}/>}
      {tab === 'stats' && <StatsTab reports={reports} notices={notices} sectors={sectors}/>}
      {floatingNotice && <button className="wo-floating-notice" onClick={() => { setFloatingNotice(''); setTab('reports'); }} role="status">🔔 {floatingNotice} · Ver reportes</button>}
    </main>
  </div>;
}
