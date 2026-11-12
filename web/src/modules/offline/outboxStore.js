const NAME = 'arca-report-outbox';
function openStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('reports', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('No se pudo guardar en este dispositivo. Revisa el espacio disponible.'));
  });
}
async function access(mode, action) {
  const db = await openStore();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('reports', mode);
    const request = action(transaction.objectStore('reports'));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('No se pudo guardar el reporte local.')); };
    transaction.onerror = () => {};
  });
}
export async function listPending(uid) {
  return (await access('readonly', store => store.getAll())).filter(item => item.uid === uid);
}
export async function savePending(item) {
  await access('readwrite', store => store.put(item));
  window.dispatchEvent(new Event('arca-outbox'));
}
export async function removePending(id) {
  await access('readwrite', store => store.delete(id));
  window.dispatchEvent(new Event('arca-outbox'));
}
