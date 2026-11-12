import { useEffect, useMemo, useRef, useState } from 'react';
import { auth } from '../auth/firebase';
import { collection, getFirestore, onSnapshot, query, where } from 'firebase/firestore';
import './CitizenTandeo.css';

// Calendario ciudadano: utiliza exactamente la colección schedule del operador.
// Documentos: schedule/{sectorId}_{YYYY-MM-DD}
// Campos: sectorId, fecha, status (continuo|parcial|corte), from, to, note.
const db = auth?.app ? getFirestore(auth.app) : null;
const DAY_LABELS = ['D', 'L', 'M', 'M', 'J', 'V', 'S'];
const STATUS = { continuo: 'Agua disponible', parcial: 'Por horario', corte: 'Sin suministro' };
const keyForDate = date => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const firstDay = date => new Date(date.getFullYear(), date.getMonth(), 1, 12);
const nextMonth = (date, amount) => new Date(date.getFullYear(), date.getMonth() + amount, 1, 12);
const longMonth = date => date.toLocaleDateString('es-MX', { month: 'long', year: 'numeric' });
const fullDate = date => date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const titleCase = text => text.charAt(0).toUpperCase() + text.slice(1);

function calendarCells(month) {
  const start = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [ ...Array(start).fill(null), ...Array.from({ length: days }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1, 12)) ];
  while (cells.length % 7) cells.push(null);
  return cells;
}

function CalendarGrid({ month, entries, selected, onSelect, compact }) {
  const today = keyForDate(new Date());
  return <div className={`ct-grid ${compact ? 'ct-grid--mini' : 'ct-grid--large'}`} aria-label={`Calendario ${longMonth(month)}`}>
    {DAY_LABELS.map((day, i) => <span className="ct-grid__weekday" key={`w${i}`}>{day}</span>)}
    {calendarCells(month).map((date, i) => {
      if (!date) return <span aria-hidden="true" key={`empty${i}`} className="ct-grid__empty" />;
      const key = keyForDate(date);
      const record = entries.get(key);
      const kind = record?.status || 'none';
      const className = `ct-day ct-day--${kind} ${today === key ? 'ct-day--today' : ''} ${selected === key ? 'ct-day--selected' : ''}`;
      const label = `${fullDate(date)}: ${STATUS[kind] || 'Sin programación publicada'}`;
      return compact
        ? <span key={key} className={className} title={label} aria-label={label}>{date.getDate()}</span>
        : <button type="button" key={key} className={className} aria-pressed={selected === key} aria-label={label} title={label} onClick={() => onSelect(date)}>{date.getDate()}</button>;
    })}
  </div>;
}

function Legend() {
  return <div className="ct-legend" aria-label="Colores del calendario">
    <span><i className="ct-legend__dot ct-legend__dot--continuo" />Con agua</span>
    <span><i className="ct-legend__dot ct-legend__dot--parcial" />Por horario</span>
    <span><i className="ct-legend__dot ct-legend__dot--corte" />Sin agua</span>
    <span><i className="ct-legend__dot ct-legend__dot--none" />Sin publicar</span>
  </div>;
}

function DayDetail({ date, entry }) {
  return <article className={`ct-detail ct-detail--${entry?.status || 'none'}`}>
    <p className="ct-detail__date">{titleCase(fullDate(date))}</p>
    <strong className="ct-detail__heading">{entry ? (STATUS[entry.status] || 'Programación publicada') : 'Sin programación publicada'}</strong>
    {entry?.status === 'parcial' && <p><b>Horario:</b> {entry.from || 'Sin definir'} – {entry.to || 'Sin definir'}</p>}
    {entry?.status === 'continuo' && <p>El suministro está programado como continuo durante el día.</p>}
    {entry?.status === 'corte' && <p>El Departamento de Operaciones programó un corte de suministro.</p>}
    {entry?.note && <p><b>Nota de Operaciones:</b> {entry.note}</p>}
    {!entry && <p>Operaciones todavía no publica un tandeo para esta fecha. Esto no significa necesariamente que habrá corte.</p>}
  </article>;
}

export default function CitizenTandeo({ profile }) {
  const [sectors, setSectors] = useState([]);
  const [days, setDays] = useState([]);
  const [notices, setNotices] = useState([]);
  const [states, setStates] = useState([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [month, setMonth] = useState(() => firstDay(new Date()));
  const [selected, setSelected] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), new Date().getDate(), 12));
  const [modalOpen, setModalOpen] = useState(false);
  const [newNotice, setNewNotice] = useState('');
  const closeRef = useRef(null);
  const previouslySeen = useRef(null);
  const sectorId = profile?.sectorId || '';

  useEffect(() => {
    if (!db) { setError('Firebase no está configurado.'); return; }
    const listen = (name, setter, filter) => onSnapshot(
      filter ? query(collection(db, name), filter) : collection(db, name),
      snapshot => setter(snapshot.docs.map(item => ({ id: item.id, ...item.data() }))),
      failure => setError(`${name}: ${failure.message}`)
    );
    const unsubs = [
      listen('sectors', setSectors, where('active', '==', true)),
      listen('notices', setNotices),
      listen('sectorStatus', setStates),
    ];
    return () => unsubs.forEach(fn => fn());
  }, []);

  useEffect(() => {
    setDays([]);
    setError('');
    setLoading(Boolean(sectorId));
    if (!db || !sectorId) { setLoading(false); return; }
    // La regla de Firestore solo deja consultar el calendario de sectores activos.
    // La igualdad por sectorId mantiene la consulta acotada.
    return onSnapshot(
      query(collection(db, 'schedule'), where('sectorId', '==', sectorId)),
      snapshot => {
        setDays(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
        setLoading(false);
      },
      failure => { setError(`No se pudo leer el calendario: ${failure.message}`); setLoading(false); }
    );
  }, [sectorId]);

  const sector = sectors.find(item => item.id === sectorId && item.active !== false);
  const entries = useMemo(() => new Map(days.filter(item => item.sectorId === sectorId).map(item => {
    // Si un documento antiguo no tiene fecha, usar fecha del ID sectorId_YYYY-MM-DD.
    const date = item.fecha || (item.id.startsWith(`${sectorId}_`) ? item.id.slice(sectorId.length + 1) : '');
    return [date, item];
  }).filter(([date]) => /^\d{4}-\d{2}-\d{2}$/.test(date))), [days, sectorId]);
  const monthEntries = [...entries].filter(([date]) => date.startsWith(`${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, '0')}`));
  const monthCount = monthEntries.length;
  const monthTotals = {
    continuo: monthEntries.filter(([, value]) => value.status === 'continuo').length,
    parcial: monthEntries.filter(([, value]) => value.status === 'parcial').length,
    corte: monthEntries.filter(([, value]) => value.status === 'corte').length,
  };
  const relevantNotices = notices.filter(item => item.audience === 'todos' || item.sectorId === sectorId)
    .sort((a, b) => (b.creadoEn?.seconds || 0) - (a.creadoEn?.seconds || 0));
  const sectorState = states.find(item => item.id === sectorId)?.state === 'reparacion' ? 'En reparación' : 'Normal / sin reparación notificada';

  useEffect(() => {
    if (!sector) { previouslySeen.current = null; return; }
    const ids = new Set(relevantNotices.map(item => item.id));
    if (previouslySeen.current) {
      const incoming = relevantNotices.find(item => !previouslySeen.current.has(item.id));
      if (incoming) setNewNotice(`Nuevo aviso de tu zona: ${incoming.title}`);
    }
    previouslySeen.current = ids;
  }, [notices, sectorId, sector?.id]);

  useEffect(() => {
    if (!modalOpen) return;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = event => { if (event.key === 'Escape') setModalOpen(false); };
    document.addEventListener('keydown', onKey);
    closeRef.current?.focus();
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', onKey); };
  }, [modalOpen]);

  function openCalendar() {
    // En cada apertura seleccionamos el día actual si está dentro del mes,
    // en otro caso el primer día del mes mostrado.
    const now = new Date();
    setSelected(month.getFullYear() === now.getFullYear() && month.getMonth() === now.getMonth()
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12) : firstDay(month));
    setModalOpen(true);
  }
  function changeMonth(delta) {
    const updated = nextMonth(month, delta);
    setMonth(updated);
    setSelected(firstDay(updated));
  }

  const currentEntry = entries.get(keyForDate(selected));
  return <section className="ct-panel" aria-label="Calendario de tandeo ciudadano">
    <div className="ct-panel__head">
      <div><h2>Mi calendario de tandeo</h2><p>Programación de agua para tu zona</p></div>
      <span className="ct-panel__sector">{sector?.name || (sectorId ? 'Sector no disponible' : 'Sin sector asignado')}</span>
    </div>
    {error && <div className="ct-error" role="alert">{error}</div>}
    {!sector ? <p className="ct-help">Selecciona un sector activo en <b>Mi perfil</b>. Si ya elegiste uno, comprueba que no haya sido desactivado por Operaciones.</p> : <>
      <button className="ct-preview" type="button" onClick={openCalendar} aria-label={`Abrir calendario de ${longMonth(month)} para ${sector.name}`}>
        <div className="ct-preview__top"><span className="ct-preview__icon" aria-hidden="true">▦</span><strong>{titleCase(longMonth(month))}</strong><span className="ct-preview__expand" aria-hidden="true">⤢</span></div>
        <CalendarGrid compact month={month} entries={entries}/>
        <Legend />
        <span className="ct-preview__foot">Ver días y horarios <span aria-hidden="true">↗</span></span>
      </button>
      <div className="ct-inline-summary" aria-live="polite">
        {loading ? 'Consultando programación…' : `${monthCount} día(s) con programación publicada`}
      </div>
      <div className="ct-notices-head"><h3>Avisos de mi zona</h3><span>{relevantNotices.length} aviso(s)</span></div>
      {newNotice && <button type="button" className="ct-toast" onClick={() => setNewNotice('')} role="status">{newNotice} · Cerrar</button>}
      {relevantNotices.length > 0 && <div className="ct-notices">{relevantNotices.slice(0, 10).map(notice => <article key={notice.id}><strong>{notice.title}</strong><p>{notice.message}</p><small>{notice.reporter || 'Departamento de Operaciones'} · {notice.audience === 'todos' ? 'Aviso general' : 'Mi sector'}</small></article>)}</div>}
      <p className="ct-sector-state"><b>Estado del sector:</b> {sectorState}</p>
    </>}
    {modalOpen && sector && <div className="ct-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setModalOpen(false); }}>
      <section className="ct-dialog" role="dialog" aria-modal="true" aria-labelledby="ct-dialog-title">
        <header className="ct-dialog__header">
          <div><span className="ct-dialog__eyebrow">HidroAlerta ARCA · {sector.name}</span><h2 id="ct-dialog-title">Calendario de tandeo</h2></div>
          <button ref={closeRef} type="button" className="ct-dialog__close" onClick={() => setModalOpen(false)} aria-label="Cerrar calendario">×</button>
        </header>
        <div className="ct-dialog__body">
          <div className="ct-modal-layout">
            <div className="ct-modal-layout__calendar">
              <div className="ct-month-nav">
                <button type="button" onClick={() => changeMonth(-1)} aria-label="Mes anterior">‹</button>
                <strong>{titleCase(longMonth(month))}</strong>
                <button type="button" onClick={() => changeMonth(1)} aria-label="Mes siguiente">›</button>
              </div>
              <CalendarGrid month={month} entries={entries} selected={keyForDate(selected)} onSelect={setSelected}/>
              <Legend />
            </div>
            <aside className="ct-modal-layout__summary" aria-label="Resumen mensual de tandeos">
              <span className="ct-info__eyebrow">Departamento de Operaciones</span>
              <h3>Programación del mes</h3>
              <div className="ct-month-count"><strong>{monthCount}</strong><span>días publicados</span></div>
              <div className="ct-status-totals">
                <div className="ct-total ct-total--continuo"><b>{monthTotals.continuo}</b><span>Con agua</span></div>
                <div className="ct-total ct-total--parcial"><b>{monthTotals.parcial}</b><span>Por horario</span></div>
                <div className="ct-total ct-total--corte"><b>{monthTotals.corte}</b><span>Sin agua</span></div>
              </div>
              <DayDetail date={selected} entry={currentEntry}/>
            </aside>
          </div>
          <p className="ct-dialog__source">Datos publicados por el Departamento de Operaciones, según tu sector registrado.</p>
        </div>
      </section>
    </div>}
  </section>;
}
