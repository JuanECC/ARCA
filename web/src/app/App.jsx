
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

// Estilos individuales de cada módulo.
import './citizen-layout.css';
import './operator-layout.css';

// ==============================================
// PANELES SEGÚN EL ROL
// ==============================================

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

  // ============================================
  // VERIFICACIÓN DE SESIÓN
  // ============================================

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

  // ============================================
  // FONDO EXCLUSIVO DE CIUDADANÍA
  // ============================================

  useEffect(() => {
    const isCitizen = session?.role === 'citizen';

    document.body.classList.toggle(
      'arca-citizen-body',
      isCitizen
    );

    return () => {
      document.body.classList.remove(
        'arca-citizen-body'
      );
    };
  }, [session?.role]);

  // ============================================
  // FONDO EXCLUSIVO DE OPERACIONES
  // ============================================

  useEffect(() => {
    const isWater =
      session?.role === 'water-operator';

    document.body.classList.toggle(
      'arca-water-body',
      isWater
    );

    return () => {
      document.body.classList.remove(
        'arca-water-body'
      );
    };
  }, [session?.role]);

  // ============================================
  // COMPROBACIÓN INICIAL
  // ============================================

  if (session === undefined) {
    return (
      <main className="page">
        <p role="status">
          Comprobando sesión...
        </p>
      </main>
    );
  }

  // ============================================
  // LOGIN
  // ============================================

  if (session === null) {
    return (
      <>
        {error && (
          <p
            className="message error"
            role="alert"
          >
            {error}
          </p>
        )}

        <AuthPage />
      </>
    );
  }

  // ============================================
  // IDENTIFICACIÓN DEL PANEL
  // ============================================

  const Panel = panels[session.role];

  const isCitizen =
    session.role === 'citizen';

  const isWater =
    session.role === 'water-operator';

  const fullScreenPanel =
    isCitizen || isWater;

  // ============================================
  // CERRAR SESIÓN
  // ============================================

  async function logout() {
    try {
      await signOut(auth);

      setSession(null);
      setError('');
    } catch (failure) {
      console.error(
        'Error al cerrar sesión:',
        failure
      );

      setError(
        'No se pudo cerrar la sesión.'
      );
    }
  }

  // ============================================
  // CLASE DEL CONTENEDOR
  // ============================================

  const pageClass = isCitizen
    ? 'page page--citizen'
    : isWater
      ? 'page page--water-operator'
      : 'page page--narrow';

  // ============================================
  // RENDER PRINCIPAL
  // ============================================

  return (
    <main className={pageClass}>

      {/* Encabezado de los demás roles.
          Ciudadanía y Operaciones tienen
          su propio encabezado interno. */}

      {!fullScreenPanel && (
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
            type="button"
            className="text-button"
            onClick={logout}
          >
            Cerrar sesión
          </button>
        </header>
      )}

      {/* Mensajes de error */}

      {error && (
        <p
          className="message error"
          role="alert"
        >
          {error}
        </p>
      )}

      {/* Panel correspondiente al rol */}

      {Panel ? (
        <Panel
          profile={session}
          onLogout={logout}
        />
      ) : (
        <p>
          No existe un panel configurado
          para el rol de esta cuenta.
        </p>
      )}

    </main>
  );
}
