import { useMemo, useState } from 'react';

const FILTERS = [
  ['todos', 'Todos'],
  ['ciudadania', 'Ciudadanía'],
  ['operaciones', 'Operaciones'],
  ['proteccion-civil', 'Protección Civil'],
  ['aviso', 'Avisos publicados'],
];
const TITLES = {
  ciudadania: 'Reporte ciudadano',
  operaciones: 'Incidencia de Operaciones',
  'proteccion-civil': 'Riesgo de Protección Civil',
  aviso: 'Aviso institucional',
};
const pretty = (value) => String(value ?? 'Sin clasificar').replaceAll('-', ' ');
const dateLabel = (value) => value instanceof Date && !Number.isNaN(value.getTime())
  ? value.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' })
  : 'Fecha no disponible';

export default function ArcaActivityFeed({ items, sectors, loading, error, onFocus }) {
  const [filter, setFilter] = useState('todos');
  const [expanded, setExpanded] = useState(null);
  const visible = useMemo(() => items.filter((item) => filter === 'todos' || item.origin === filter), [items, filter]);
  const sectorName = (id) => sectors.find((s) => s.id === id)?.name || id || 'Sin sector asignado';

  return (
    <section className="pc-feed" aria-labelledby="pc-feed-title">
      <div className="pc-feed__heading">
        <div>
          <span className="pc-feed__eyebrow">Monitoreo compartido · Firestore</span>
          <h2 id="pc-feed-title">Actividad y alertas de ARCA</h2>
          <p>Reportes ciudadanos, incidencias institucionales y avisos publicados en tiempo real.</p>
        </div>
        <span className="pc-feed__total" aria-label={`${items.length} registros`}>{items.length} registros</span>
      </div>
      <div className="pc-feed__tabs" aria-label="Filtrar origen">
        {FILTERS.map(([key, label]) => (
          <button key={key} type="button" className={filter === key ? 'is-active' : ''}
            aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {label} <span>{items.filter((a) => key === 'todos' || a.origin === key).length}</span>
          </button>
        ))}
      </div>
      {loading && <p className="pc-feed__message" role="status">Sincronizando registros con Firebase…</p>}
      {error && <p className="pc-feed__message pc-feed__message--error" role="alert">Error al cargar datos: {error}</p>}
      {!loading && !error && visible.length === 0 && <p className="pc-feed__message">No hay registros para este filtro. Comprueba que se hayan publicado en Firestore.</p>}
      <div className="pc-feed__list">
        {visible.map((item) => {
          const open = expanded === item.key;
          return (
            <article className={`pc-feed__item pc-feed__item--${item.origin}`} key={item.key}>
              <button type="button" className="pc-feed__item-main" aria-expanded={open}
                onClick={() => setExpanded(open ? null : item.key)}>
                <span className="pc-feed__item-top">
                  <span className="pc-feed__source">{TITLES[item.origin]}</span>
                  <span className="pc-feed__status">{pretty(item.status)}</span>
                </span>
                <strong>{item.title}</strong>
                <span className="pc-feed__item-meta">{sectorName(item.sectorId)} · {dateLabel(item.date)}</span>
                <span className="pc-feed__item-meta">{item.reporter || 'Autor no indicado'}</span>
              </button>
              {open && (
                <div className="pc-feed__item-detail">
                  <p>{item.description || 'Sin descripción adicional.'}</p>
                  {item.photo && <img loading="lazy" src={item.photo} alt={`Evidencia de ${item.title}`} />}
                  {item.position && <button type="button" className="pc-feed__locate" onClick={() => onFocus(item.position)}>Ver ubicación en el mapa</button>}
                  <small>ID: {item.id}</small>
                </div>
              )}
            </article>
          );
        })}
      </div>
      <p className="pc-feed__disclaimer">Los avisos publicados pueden referirse a un reporte ya listado. Solo las alertas creadas por Protección Civil se gestionan desde «Alertas priorizadas».</p>
    </section>
  );
}
