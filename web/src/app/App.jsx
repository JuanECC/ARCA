
import { useEffect, useState } from 'react';
import { onAuthStateChanged, signOut } from 'firebase/auth';

import AuthPage from '../modules/auth/AuthPage';

import {
  auth,
  ensureProfile,
  accountError,
} from '../modules/auth/firebase';

import { roleLabels } from '../modules/auth/roles';

import AdminPanel from '../modules/admin/AdminPanel';
import CitizenReports from '../modules/citizen-reports/CitizenReports';
import WaterOperations from '../modules/water-operations/WaterOperations';
import CivilProtection from '../modules/civil-protection/CivilProtection';
import MaintenanceCrew from '../modules/maintenance-crew/MaintenanceCrew';

// Panel correspondiente a cada rol.
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

    const unsubscribe = onAuthStateChanged(
      auth,
      async (user) => {
        const currentRevision = ++revision;

        if (!user) {
          if (active) {
            setSession(null);
          }
          return;
        }

        try {
          const profile = await ensureProfile(user);

          if (!active || currentRevision !== revision) {
            return;
          }

          setSession(profile);
          setError('');
        } catch (failure) {
          if (!active || currentRevision !== revision) {
            return;
          }

          console.error(
            'Error al cargar perfil:',
            failure
          );

          setSession(null);
          setError(accountError(failure));

          try {
            await signOut(auth);
          } catch (logoutError) {
            console.error(
              'Error al cerrar sesión:',
              logoutError
            );
          }
        }
      }
    );

    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (session === undefined) {
    return (
      <main className="page">
        <p role="status">
          Comprobando sesión...
        </p>
      </main>
    );
  }

  if (session === null) {
    return (
      <>
        {error && (
          <p className="message error" role="alert">
            {error}
          </p>
        )}
        <AuthPage />
      </>
    );
  }

  const Panel = panels[session.role];

  async function logout() {
    try {
      await signOut(auth);
      setSession(null);
      setError('');
    } catch {
      setError(
        'No se pudo cerrar la sesión.'
      );
    }
  }

  return (
    <main className="page page--narrow">
      <header className="panel-header">
        <div>
          <p className="eyebrow">
            HidroAlerta Veracruz
          </p>

          <h1>
            {Panel
              ? roleLabels[session.role]
              : 'Acceso pendiente'}
          </h1>

          <p className="muted">
            {session.nombre ||
              session.email ||
              'Usuario'}
          </p>
        </div>

        <button
          className="text-button"
          onClick={logout}
        >
          Cerrar sesión
        </button>
      </header>

      {error && (
        <p className="message error" role="alert">
          {error}
        </p>
      )}

      {Panel ? (
        <Panel />
      ) : (
        <p>
          No existe un panel configurado
          para el rol de esta cuenta.
        </p>
      )}
    </main>
  );
}
