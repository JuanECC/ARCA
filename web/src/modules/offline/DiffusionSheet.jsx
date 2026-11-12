import { useState } from 'react';

export default function DiffusionSheet({ alert, sectorName }) {
  const [simulation, setSimulation] = useState(true);
  if (!alert.alert?.message) return null;
  const text = [
    simulation ? 'SIMULACIÓN PARA DEMOSTRACIÓN · ARCA' : 'ARCA · FICHA PARA DIFUSIÓN LOCAL',
    alert.alert.title,
    'Sector: ' + sectorName,
    'Ubicación de referencia: ' + alert.colonia,
    'Emisor registrado: ' + (alert.alert.by || 'Protección Civil'),
    'Fecha del aviso: ' + (alert.alert.at || 'No disponible'),
    'Estado registrado: ' + (alert.closure ? 'Controlado' : 'Activo'),
    '',
    alert.alert.message,
    '',
    'Antes de difundir, el personal autorizado debe confirmar vigencia y contenido.',
    'Canal previsto: perifoneo o comunicación presencial mediante personal autorizado.',
    'Esta ficha no acredita que la población haya recibido el aviso.',
  ].join('\n');
  function download() {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'arca-aviso-difusion-local.txt';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <details className="offline-flyer">
    <summary>Ficha de difusión durante cortes de internet</summary>
    <label><input type="checkbox" checked={simulation} onChange={event => setSimulation(event.target.checked)} /> Marcar como simulación para la demo</label>
    <p>{text}</p>
    <button type="button" className="btn btn--secondary" onClick={download}>Descargar ficha</button>
  </details>;
}
