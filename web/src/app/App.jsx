import { useEffect, useState } from 'react';
import { onIdTokenChanged, signOut } from 'firebase/auth';
import AuthPage from '../modules/auth/AuthPage';
import { accountError, auth, ensureProfile } from '../modules/auth/firebase';
import { roleLabels } from '../modules/auth/roles';
import AdminPanel from '../modules/admin/AdminPanel';
import CitizenReports from '../modules/citizen-reports/CitizenReports';
import WaterOperations from '../modules/water-operations/WaterOperations';
import CivilProtection from '../modules/civil-protection/CivilProtection';

import MaintenanceCrew from '../modules/maintenance-crew/MaintenanceCrew';

const panels = new Map([
  ['maintenance-crew', MaintenanceCrew],
  ['admin', AdminPanel],
  ['citizen', CitizenReports],
  ['water-operator', WaterOperations],
  ['civil-protection', CivilProtection],
]);

export default function App() {
  const [session, setSession] = useState(auth ? undefined : null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth) return undefined;
    let current = true;
    let revision = 0;
    const unsubscribe = onIdTokenChanged(auth, async (user) => {
      const event = ++revision;
      try {
        const profile = user ? await ensureProfile(user) : null;
        if (current && event === revision) setSession(profile);
      } catch (failure) {
        if (current && event === revision) {
          setSession({});
          setError(accountError(failure));
        }
      }
    });
    return () => { current = false; unsubscribe(); };
  }, []);

  if (session === undefined) return <main className="page"><p role="status">Comprobando sesión…</p></main>;
  if (!session) return <AuthPage />;

  const Panel = panels.get(session.role);

  async function logout() {
    try {
      await signOut(auth);
      setError('');
    } catch {
      setError('No se pudo cerrar la sesión. Inténtalo nuevamente.');
    }
  }

  return (
    <main className="page page--narrow">
      <header className="panel-header">
        <div>
          <p className="eyebrow">HidroAlerta Veracruz</p>
          <h1>{Panel ? roleLabels[session.role] : 'Acceso pendiente'}</h1>
          <p className="muted">{session.nombre || session.email}</p>
        </div>
        <button className="text-button" onClick={logout}>Cerrar sesión</button>
      </header>
      {error && <p className="message error" role="alert">{error}</p>}
      {Panel ? <Panel /> : <p>Esta cuenta necesita un rol asignado por el sistema.</p>}
    </main>
  );
}
