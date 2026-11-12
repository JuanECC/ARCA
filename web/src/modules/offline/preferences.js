export function offlineEnabled() {
  try { return localStorage.getItem('arca-offline-enabled') === 'true'; }
  catch { return false; }
}
