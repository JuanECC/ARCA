import { useState } from 'react';
import { accountError, login, register } from './firebase';
import arcaLogo from '../../assets/gem1.png';

function Field({ label, name, icon, ...props }) {
  const id = `auth-${name}`;

  return (
    <label className="field" htmlFor={id}>
      <span className="field__label">{label}</span>

      <span className="field__control">
        <span className="material-symbols-outlined" aria-hidden="true">
          {icon}
        </span>

        <input
          className="input"
          id={id}
          name={name}
          required
          {...props}
        />
      </span>
    </label>
  );
}

export function RegistrationFields() {
  return (
    <>
      <Field
        label="Nombre completo"
        name="nombre"
        icon="person"
        type="text"
        autoComplete="name"
        minLength={2}
        maxLength={100}
      />

      <p className="muted small">
        Usarás tu nombre para iniciar sesión. Agrega tus apellidos para
        distinguir tu cuenta.
      </p>

      <Field
        label="Correo electrónico"
        name="email"
        icon="mail"
        type="email"
        autoComplete="email"
        maxLength={254}
      />

      <Field
        label="Contraseña (mínimo 8 caracteres)"
        name="password"
        icon="lock"
        type="password"
        autoComplete="new-password"
        minLength={8}
        maxLength={128}
      />
    </>
  );
}

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const registering = mode === 'register';

  function switchMode() {
    setMode(registering ? 'login' : 'register');
    setError('');
  }

  async function submit(event) {
    event.preventDefault();

    const data = Object.fromEntries(new FormData(event.currentTarget));

    setBusy(true);
    setError('');

    try {
      if (registering) {
        await register(data);
      } else {
        await login(data);
      }
    } catch (failure) {
      setError(accountError(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="access-page">
      <header className="access-intro">
        <div className="access-logo">
          <img src={arcaLogo} alt="Logotipo de ARCA" />
        </div>

        <span className="access-brand">ARCA · Veracruz</span>

        <div className="access-intro__copy">
          <h1 className="access-title">HidroAlerta Veracruz</h1>
          <p className="access-tagline">
            Del reporte ciudadano a la acción preventiva.
          </p>
        </div>
      </header>

      <section className="card access-card" aria-labelledby="access-title">
        <div className="access-card__heading">
          <h2 id="access-title">
            {registering ? 'Crea tu cuenta' : 'Inicia sesión'}
          </h2>
          <p>
            {registering
              ? 'Registra tus datos para crear tu cuenta ciudadana.'
              : 'Ingresa con tu nombre de usuario y contraseña para acceder a la red de monitoreo y alertas.'}
          </p>
        </div>

        <form key={mode} onSubmit={submit}>
          {registering ? (
            <RegistrationFields />
          ) : (
            <>
              <Field
                label="Nombre de usuario"
                name="usuario"
                icon="person"
                type="text"
                autoComplete="username"
                autoCapitalize="none"
                maxLength={100}
                placeholder="Ej. carlos.mendoza"
              />

              <p className="field-hint">
                <span className="material-symbols-outlined" aria-hidden="true">
                  verified_user
                </span>
                Identificador cívico o correo verificado
              </p>

              <Field
                label="Contraseña"
                name="password"
                icon="lock"
                type="password"
                autoComplete="current-password"
                maxLength={128}
                placeholder="••••••••••••"
              />

              <label className="remember-option">
                <input name="remember" type="checkbox" />
                <span>Recordar mis datos en este dispositivo</span>
              </label>
            </>
          )}

          {error && (
            <p className="message error" role="alert">
              {error}
            </p>
          )}

          <button
            className="primary access-submit"
            type="submit"
            disabled={busy}
          >
            {busy
              ? 'Procesando…'
              : registering
                ? 'Crear cuenta'
                : 'Entrar'}
            {!busy && <span aria-hidden="true">→</span>}
          </button>
        </form>

        <div className="access-register">
          <div>
            <h3>
              {registering
                ? '¿Ya tienes una cuenta?'
                : '¿Aún no tienes cuenta?'}
            </h3>
            <p>
              {registering
                ? 'Vuelve al inicio de sesión para acceder a la red.'
                : 'Únete para reportar anegaciones y recibir alertas tempranas.'}
            </p>
          </div>

          <button
            className="text-button"
            type="button"
            disabled={busy}
            onClick={switchMode}
          >
            {registering ? 'Iniciar sesión' : 'Crear cuenta ciudadana'}
          </button>
        </div>
      </section>

      {!registering && (
        <div className="network-status">
          <span className="material-symbols-outlined" aria-hidden="true">
            water_drop
          </span>
          Red de Monitoreo Activa
        </div>
      )}

      <footer className="access-footer">
        <strong>Gobierno del Estado de Veracruz</strong>
        <p>
          Sistema de Alerta Temprana Hidrometeorológica · Protección Civil y
          Gestión de Riesgos Veracruz
        </p>
      </footer>
    </main>
  );
}