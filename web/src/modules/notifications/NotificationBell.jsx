// ARCA · Campana de notificaciones. Todo flota encima de la página (posición fija):
// no empuja ni deforma el diseño de ningún panel, en PC ni en celular.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { auth } from '../auth/firebase';
import { subscribeNotifications } from './notificationsService';
import { enablePush, pushAvailable, pushPermission } from './pushService';
import './NotificationBell.css';

const DAY = 24 * 60 * 60 * 1000;
const MAX_READ = 300;

function Icon({ name }) {
  return <span className="material-symbols-outlined" aria-hidden="true">{name}</span>;
}

function timeAgo(ms) {
  if (!ms) return '';
  const minutes = Math.round((Date.now() - ms) / 60000);
  if (minutes < 60) return `hace ${Math.max(minutes, 1)} min`;
  if (minutes < 1440) return `hace ${Math.round(minutes / 60)} h`;
  return `hace ${Math.round(minutes / 1440)} d`;
}

// "Leído" se guarda en el navegador, por usuario (Fase 2: en su cuenta)
const storageKey = (uid) => `arca-notificaciones:${uid}`;
function loadRead(uid) {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey(uid)));
    return saved ? new Set(saved) : null;
  } catch {
    return null;
  }
}
function saveRead(uid, read) {
  try {
    localStorage.setItem(storageKey(uid), JSON.stringify([...read].slice(-MAX_READ)));
  } catch {
    /* sin almacenamiento: solo dura la sesión */
  }
}

export default function NotificationBell({ role, sectorId }) {
  const uid = auth?.currentUser?.uid;
  const [items, setItems] = useState([]);
  const [read, setRead] = useState(() => (uid && loadRead(uid)) || new Set());
  const [open, setOpen] = useState(false);
  const [toasts, setToasts] = useState([]);
  const known = useRef(null); // ids ya vistos en esta sesión (para avisar solo lo nuevo)
  const rootRef = useRef(null);
  const layerRef = useRef(null);
  // La lista y los avisos se dibujan en el contenedor del panel (el que tiene data-theme):
  // así heredan sus colores y no quedan atrapados en el encabezado (que usa backdrop-filter).
  const [layer, setLayer] = useState(null);
  // Avisos en el celular aunque ARCA esté cerrada: no-disponible | default | granted | denied | activando
  const [push, setPush] = useState('no-disponible');

  useEffect(() => {
    setLayer(rootRef.current?.closest('[data-theme]') ?? document.body);
  }, []);

  // Si ya dio permiso, se vuelve a registrar el celular en silencio (mantiene el sector al día)
  useEffect(() => {
    if (!uid) return;
    let alive = true;
    pushAvailable().then(async (available) => {
      if (!alive || !available) return;
      const permission = pushPermission();
      setPush(permission);
      if (permission === 'granted') {
        const result = await enablePush({ sectorId }).catch(() => 'default');
        if (alive) setPush(result);
      }
    });
    return () => {
      alive = false;
    };
  }, [uid, sectorId]);

  const activatePush = async () => {
    setPush('activando');
    const result = await enablePush({ sectorId, ask: true }).catch((error) => {
      console.error('Notificaciones push:', error);
      return 'default';
    });
    setPush(result);
  };

  useEffect(() => {
    if (!uid) return undefined;
    known.current = null;
    return subscribeNotifications(role, { uid, sectorId }, (list) => {
      // Primera vez en este navegador: lo de más de 24 h cuenta como leído
      if (!loadRead(uid)) {
        const old = new Set(list.filter((n) => Date.now() - n.at > DAY).map((n) => n.id));
        saveRead(uid, old);
        setRead(old);
      }
      // Aviso flotante solo para lo que llega después de abrir el panel
      if (known.current) {
        const fresh = list.filter((n) => !known.current.has(n.id)).slice(0, 3);
        if (fresh.length) setToasts((current) => [...fresh, ...current].slice(0, 3));
      }
      known.current = new Set([...(known.current ?? []), ...list.map((n) => n.id)]);
      setItems(list);
    }, (error) => console.error('Notificaciones:', error));
  }, [role, uid, sectorId]);

  // Los avisos flotantes se cierran solos
  useEffect(() => {
    if (!toasts.length) return undefined;
    const timer = setTimeout(() => setToasts((current) => current.slice(0, -1)), 6000);
    return () => clearTimeout(timer);
  }, [toasts]);

  // Cerrar con Escape o tocando fuera
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    const onClick = (e) => !rootRef.current?.contains(e.target) && !layerRef.current?.contains(e.target) && setOpen(false);
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open]);

  if (!uid) return null;

  const unread = items.filter((n) => !read.has(n.id)).length;
  const markRead = (ids) => {
    const next = new Set([...read, ...ids]);
    setRead(next);
    saveRead(uid, next);
  };

  return (
    <div className="arca-notif" ref={rootRef}>
      <button
        type="button"
        className="arca-notif__bell"
        onClick={() => {
          setOpen(!open);
          setToasts([]); // al abrir la lista, los avisos sobran
        }}
        aria-label={unread ? `Notificaciones: ${unread} sin leer` : 'Notificaciones'}
        aria-expanded={open}
        title="Notificaciones"
      >
        <Icon name={unread ? 'notifications_active' : 'notifications'} />
        {unread > 0 && <span className="arca-notif__badge">{unread > 9 ? '9+' : unread}</span>}
      </button>

      {layer && createPortal(
        <div className="arca-notif arca-notif--layer" ref={layerRef}>
          {open && (
            <>
              <div className="arca-notif__backdrop" onClick={() => setOpen(false)} />
              <section className="arca-notif__panel" role="dialog" aria-label="Notificaciones">
                <header className="arca-notif__head">
                  <strong>Notificaciones</strong>
                  {unread > 0 && (
                    <button type="button" className="arca-notif__mark" onClick={() => markRead(items.map((n) => n.id))}>
                      <Icon name="done_all" /> Marcar todas como leídas
                    </button>
                  )}
                  <button type="button" className="arca-notif__close" onClick={() => setOpen(false)} aria-label="Cerrar">
                    <Icon name="close" />
                  </button>
                </header>

                {push !== 'no-disponible' && (
                  <div className={`arca-notif__push arca-notif--${push === 'granted' ? 'success' : push === 'denied' ? 'error' : 'primary'}`}>
                    <Icon name={push === 'granted' ? 'mobile_friendly' : push === 'denied' ? 'notifications_off' : 'phone_iphone'} />
                    {push === 'granted' && <span>Avisos activados en este celular, aunque ARCA esté cerrada.</span>}
                    {push === 'denied' && <span>Las notificaciones están bloqueadas. Actívalas en los ajustes del navegador.</span>}
                    {(push === 'default' || push === 'activando') && (
                      <>
                        <span>Recibe las alertas aunque ARCA esté cerrada.</span>
                        <button type="button" className="arca-notif__push-btn" onClick={activatePush} disabled={push === 'activando'}>
                          {push === 'activando' ? 'Activando…' : 'Activar'}
                        </button>
                      </>
                    )}
                  </div>
                )}

                {items.length === 0 ? (
                  <p className="arca-notif__empty">
                    <Icon name="notifications_off" /> No tienes notificaciones.
                  </p>
                ) : (
                  <ul className="arca-notif__list">
                    {items.map((n) => (
                      <li key={n.id}>
                        <button
                          type="button"
                          className={`arca-notif__item arca-notif--${n.tone} ${read.has(n.id) ? '' : 'is-unread'}`}
                          onClick={() => markRead([n.id])}
                        >
                          <span className="arca-notif__icon"><Icon name={n.icon} /></span>
                          <span className="arca-notif__text">
                            <strong>{n.title}</strong>
                            {n.body && <span>{n.body}</span>}
                            <small>{timeAgo(n.at)}</small>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </>
          )}

          {!open && toasts.length > 0 && (
            <div className="arca-notif__toasts" aria-live="polite">
              {toasts.map((n) => (
                <div key={n.id} className={`arca-notif__toast arca-notif--${n.tone}`}>
                  <span className="arca-notif__icon"><Icon name={n.icon} /></span>
                  <span className="arca-notif__text">
                    <strong>{n.title}</strong>
                    {n.body && <span>{n.body}</span>}
                  </span>
                  <button
                    type="button"
                    className="arca-notif__close"
                    onClick={() => setToasts((current) => current.filter((t) => t.id !== n.id))}
                    aria-label="Cerrar aviso"
                  >
                    <Icon name="close" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>,
        layer,
      )}
    </div>
  );
}
