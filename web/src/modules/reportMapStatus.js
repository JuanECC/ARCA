export function reportMapStatus(state) {
  if (state === 'en-reparacion') return { label: 'En reparación', color: '#b45309', hammer: true };
  if (state === 'reparado' || state === 'resuelto') {
    return { label: state === 'resuelto' ? 'Resuelto' : 'Reparado', color: '#15803d' };
  }
  return { label: state === 'en-revision' ? 'En revisión' : 'Por atender', color: '#2563eb' };
}
