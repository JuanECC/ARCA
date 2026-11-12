import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';

import AuthPage from '../modules/auth/AuthPage';
import { auth, ensureProfile, accountError } from '../modules/auth/firebase';
import { roleLabels } from '../modules/auth/roles';

import AdminPanel from '../modules/admin/AdminPanel';
import CitizenReports from '../modules/citizen-reports/CitizenReports';
import WaterOperations from '../modules/water-operations/WaterOperations';
import CivilProtection from '../modules/civil-protection/CivilProtection';
import MaintenanceCrew from '../modules/maintenance-crew/MaintenanceCrew';
import OfflineCenter from '../modules/offline/OfflineCenter';

import './citizen-layout.css';
import './operator-layout.css';
import './civil-protection-layout.css';
import './maintenance-layout.css';

const panels = {
  admin: AdminPanel,
  citizen: CitizenReports,
  'water-operator': WaterOperations,
  'civil-protection': CivilProtection,
  'maintenance-crew': MaintenanceCrew,
};

export default function App() {
  const [session, setSession] = useState(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!auth) {
      setSession(null);
      return;
    }

    let active = true;
    let revision = 0;

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      const currentRevision = ++revision;

      if (!user) {
        if (active) setSession(null);
        return;
      }

      try {
        const profile = await ensureProfile(user);
        if (!active || currentRevision !== revision) return;
        setSession(profile);
        setError('');
      } catch (failure) {
        if (!active || currentRevision !== revision) return;
        console.error('Error al cargar perfil:', failure);
        setSession(null);
        setError(accountError(failure));
        try {
          if (navigator.onLine && !['unavailable', 'deadline-exceeded'].includes(failure.code)) await signOut(auth);
        } catch (logoutError) {
          console.error('Error al cerrar sesión:', logoutError);
        }
      }
    });

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  // Los fondos son exclusivos de cada rol; otros paneles no se afectan.
  useEffect(() => {
    const role = session?.role;
    document.body.classList.toggle('arca-citizen-body', role === 'citizen');
    document.body.classList.toggle('arca-water-body', role === 'water-operator');
    document.body.classList.toggle('arca-pc-body', role === 'civil-protection');

    return () => {
      document.body.classList.remove(
        'arca-citizen-body', 'arca-water-body', 'arca-pc-body'
      );
    };
  }, [session?.role]);

  if (session === undefined) {
    return (
      <main className="page">
        <p role="status">Comprobando sesión...</p>
      </main>
    );
  }

  if (session === null) {
    return (
      <>
        {error && <p className="message error" role="alert">{error}</p>}
        {!navigator.onLine && <p role="status">Sin conexión. Para abrir tu cuenta aquí debes haber preparado el dispositivo y conservado la sesión. <button onClick={() => location.reload()}>Reintentar</button></p>}
        <AuthPage />
      </>
    );
  }

  const Panel = panels[session.role];
  const isCitizen = session.role === 'citizen';
  const isWater = session.role === 'water-operator';
  const isCivil = session.role === 'civil-protection';
  const isMaintenance = session.role === 'maintenance-crew';
  const ownHeader = isCitizen || isWater || isCivil || isMaintenance;

  const pageClass = isCitizen
    ? 'page page--citizen'
    : isWater
      ? 'page page--water-operator'
      : isCivil
        ? 'page page--civil-protection'
        : isMaintenance ? 'page page--maintenance' : 'page page--narrow';

  async function logout() {
    try {
      await signOut(auth);
      setSession(null);
      setError('');
    } catch (failure) {
      console.error('Error al cerrar sesión:', failure);
      setError('No se pudo cerrar la sesión.');
    }
  }

  return (
    <main className={pageClass}>
      <OfflineCenter key={session.uid} profile={session} />
      {!ownHeader && (
        <header className="panel-header">
          <div>
            <p className="eyebrow">HidroAlerta Veracruz</p>
            <h1>{Panel ? roleLabels[session.role] : 'Acceso pendiente'}</h1>
            <p className="muted">
              {session.nombre || session.email || 'Usuario'}
            </p>
          </div>
          <button type="button" className="text-button" onClick={logout}>
            Cerrar sesión
          </button>
        </header>
      )}

      {error && <p className="message error" role="alert">{error}</p>}

      {Panel ? (
        <Panel profile={session} onLogout={logout} />
      ) : (
        <p>No existe un panel configurado para el rol de esta cuenta.</p>
      )}
    </main>
  );
}
