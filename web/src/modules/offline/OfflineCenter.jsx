import { useEffect, useState } from 'react';
import { collection, doc, getDocFromServer, getDocsFromServer, getFirestore, onSnapshot, query, where } from 'firebase/firestore';
import { auth } from '../auth/firebase';
import { offlineEnabled } from './preferences';
import { listPending } from './outboxStore';
import { syncPendingReports } from './reportSync';
import './offline.css';

const stampKey = uid => 'arca-offline-prepared-' + uid;
function savedTime(uid) {
  try { return localStorage.getItem(stampKey(uid)); } catch { return null; }
}

export default function OfflineCenter({ profile }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [pending, setPending] = useState([]);
  const [notices, setNotices] = useState([]);
  const [reports, setReports] = useState([]);
  const [last, setLast] = useState(() => savedTime(profile.uid));
  const [cached, setCached] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [opened, setOpened] = useState(false);
  const enabled = offlineEnabled();

  useEffect(() => {
    let active = true;
    const refresh = () => listPending(profile.uid).then(items => { if (active) setPending(items); })
      .catch(() => { if (active) setMessage('El almacenamiento local no está disponible.'); });
    const sync = () => {
      setOnline(navigator.onLine);
      void syncPendingReports().catch(() => setMessage('No se pudieron revisar los pendientes.'));
    };
    const sent = event => setMessage('Enviado a Firebase: ' + event.detail);
    refresh();
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    window.addEventListener('arca-outbox', refresh);
    window.addEventListener('arca-report-sent', sent);
    const interval = setInterval(sync, 30000);
    return () => {
      active = false;
      clearInterval(interval);
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
      window.removeEventListener('arca-outbox', refresh);
      window.removeEventListener('arca-report-sent', sent);
    };
  }, [profile.uid]);

  useEffect(() => {
    if (!enabled) return;
    const db = getFirestore(auth.app);
    const serverSeen = new Set();
    const observe = (name, setData) => onSnapshot(collection(db, name), { includeMetadataChanges: true }, snapshot => {
      setData(snapshot.docs.map(item => ({ id: item.id, ...item.data() })));
      if (snapshot.metadata.fromCache) serverSeen.delete(name);
      else serverSeen.add(name);
      setCached(serverSeen.size !== 2);
      if (serverSeen.size === 2 && savedTime(profile.uid)) {
        const time = new Date().toISOString();
        try {
          localStorage.setItem(stampKey(profile.uid), time);
          setLast(time);
        } catch { setMessage('No se pudo conservar la fecha de descarga en este dispositivo.'); }
      }
    }, () => setMessage('No se pudo actualizar la información guardada.'));
    const stop = [observe('notices', setNotices), observe('reportes', setReports)];
    return () => stop.forEach(unsubscribe => unsubscribe());
  }, [profile.uid, enabled]);

  async function prepare() {
    if (!navigator.onLine) { setMessage('Conéctate para preparar el dispositivo.'); return; }
    if (import.meta.env.DEV) {
      setMessage('La demo con recarga sin internet se prepara en la versión compilada: npm run build y npm run preview --prefix web.');
      return;
    }
    if (!enabled) {
      try {
        localStorage.setItem('arca-offline-enabled', 'true');
        localStorage.setItem('arca-offline-prepare', 'true');
        location.reload();
      } catch { setMessage('El navegador no permite guardar datos en este dispositivo.'); }
      return;
    }
    setBusy(true);
    try {
      if (!('serviceWorker' in navigator)) throw new Error('Este navegador requiere HTTPS o localhost para preparar la aplicación.');
      await navigator.serviceWorker.register('/sw.js');
      await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, reject) => setTimeout(() => reject(new Error('No terminó la descarga de la aplicación. Reintenta con conexión.')), 20000)),
      ]);
      const db = getFirestore(auth.app);
      const reads = [
        getDocFromServer(doc(db, 'usuarios', profile.uid)),
        getDocsFromServer(collection(db, 'reportes')),
        getDocsFromServer(collection(db, 'notices')),
        getDocsFromServer(query(collection(db, 'sectors'), where('active', '==', true))),
      ];
      if (profile.role === 'citizen') reads.push(getDocFromServer(doc(db, 'usuarios', profile.uid, 'configuracion', 'perfil')));
      await Promise.all(reads);
      const time = new Date().toISOString();
      localStorage.setItem(stampKey(profile.uid), time);
      localStorage.removeItem('arca-offline-prepare');
      setLast(time);
      setMessage('Aplicación, avisos, reportes y guía preparados. Mantén iniciada tu sesión antes del corte.');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }

  useEffect(() => {
    if (!enabled || import.meta.env.DEV) return;
    if (localStorage.getItem('arca-offline-prepare') === 'true') void prepare();
    else navigator.serviceWorker?.register('/sw.js').catch(() => {});
  }, [profile.uid]);

  const relevant = notices.filter(item => item.kind === 'alerta-proteccion-civil');
  return <aside className="offline-center">
    <details open={opened}>
      <summary onClick={event => { event.preventDefault(); setOpened(value => !value); }}>
        {online ? 'Conexión y pendientes' : 'Sin conexión'}{pending.length > 0 ? ` · ${pending.length} pendiente(s)` : ''}
      </summary>
      <div className="offline-content">
        <p role="status">{!online || cached ? 'Consultando información guardada. Puede haber cambios que aún no recibiste.' : 'Datos recibidos de Firebase.'}</p>
        <p>{last ? 'Última descarga: ' + new Date(last).toLocaleString('es-MX') : 'Este dispositivo todavía no está preparado para recargar ARCA sin conexión.'}</p>
        <p>Los avisos nuevos requieren conexión. Ante un corte total, la difusión depende del personal local y los canales disponibles.</p>
        {!enabled && <p>Al preparar este dispositivo se guardan datos e imágenes localmente. Hazlo en un equipo de confianza. Los datos permanecen hasta borrar el almacenamiento del sitio.</p>}
        <button type="button" disabled={!online || busy} onClick={prepare}>{busy ? 'Descargando…' : last ? 'Actualizar descarga' : 'Preparar este dispositivo'}</button>
        {message && <p role="status">{message}</p>}
        {profile.role === 'citizen' && <section>
          <h3>Reportes pendientes de envío</h3>
          <p>Se enviarán al abrir ARCA con conexión y con la misma cuenta. Borrar los datos del navegador elimina los pendientes.</p>
          {pending.length === 0 ? <p>No hay pendientes en este dispositivo.</p> : pending.map(item => <article key={item.id}>
            <strong>{item.payload.titulo}</strong><p>Guardado aquí: {new Date(item.guardadoEn).toLocaleString('es-MX')}</p>
            <p>{item.error || 'Pendiente de confirmación de Firebase.'}</p>
            {item.payload.fotoBase64 && <img src={item.payload.fotoBase64} alt="Foto guardada pendiente de envío" />}
          </article>)}
          <button type="button" disabled={!online || !pending.length} onClick={() => void syncPendingReports().catch(() => setMessage('No se pudo reintentar.'))}>Reintentar envío</button>
        </section>}
        <details><summary>Avisos descargados ({relevant.length})</summary>
          {relevant.length === 0 && <p>No hay avisos descargados. Esto no indica ausencia de riesgo.</p>}
          {relevant.map(item => <article key={item.id}>
            <strong>{item.title}</strong><p>{item.message}</p><p>Emisor: {item.reporter}</p>
            <p>{item.estado === 'controlado' ? 'Controlado según la última descarga' : 'Estado de la última descarga: activo'}</p>
            <p>Publicado: {item.creadoEn?.toDate?.().toLocaleString('es-MX') || 'Fecha no disponible'}</p>
            {item.fotoBase64 && <img src={item.fotoBase64} alt="Evidencia del aviso guardado" />}
          </article>)}
        </details>
        <details><summary>Reportes descargados ({reports.length})</summary>
          <p>Consulta alternativa cuando el mapa base no carga.</p>
          {reports.map(item => <article key={item.id}><strong>{item.titulo}</strong>
            <p>{item.descripcion}</p><p>Estado guardado: {item.estado}</p>
            <p>Ubicación: {item.ubicacion?.lat}, {item.ubicacion?.lng}</p>
          </article>)}
        </details>
        <details><summary>Guía ante inundaciones</summary>
          <p>Evita atravesar corrientes y calles inundadas, caminando o en vehículo. Mantente lejos de instalaciones y cables eléctricos dañados. Si Protección Civil ordena evacuar, sigue sus indicaciones de inmediato.</p>
          <p>Resumen de CENAPRED consultado el 12 de noviembre de 2026. Ante peligro inmediato busca ayuda de los servicios de emergencia locales por el medio disponible.</p>
          <a href="https://www.gob.mx/cenapred/documentos/infografia-en-caso-de-inundacion" target="_blank" rel="noreferrer">Fuente oficial (requiere conexión)</a>
        </details>
      </div>
    </details>
  </aside>;
}
