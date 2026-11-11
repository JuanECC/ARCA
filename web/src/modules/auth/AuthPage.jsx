import { useState } from 'react';
import { accountError, login, register } from './firebase';

export function Field({ label, name, ...props }) {
  return (
    <label className="field">
      <span className="field__label">{label}</span>
      <input className="input" name={name} required {...props} />
    </label>
  );
}

export function RegistrationFields() {
  return (
    <>
      <Field label="Nombre completo" name="nombre" autoComplete="name" minLength={2} maxLength={100} />
      <p className="muted small">Usarás tu nombre completo para iniciar sesión. Agrega tus apellidos para distinguir tu cuenta.</p>
      <Field label="Correo electrónico" name="email" type="email" autoComplete="email" maxLength={254} />
      <Field label="Contraseña (mínimo 8 caracteres)" name="password" type="password"
        autoComplete="new-password" minLength={8} maxLength={128} />
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
      <header className="access-intro" aria-label="HidroAlerta Veracruz">
        <span className="access-brand">ARCA · Veracruz</span>
        <p className="access-title">HidroAlerta Veracruz</p>
        <p>Del reporte ciudadano a la acción preventiva.</p>
      </header>
      <section className="card access-card" aria-labelledby="access-title">
        <div className="access-card__heading">
          <h1 id="access-title">{registering ? 'Crea tu cuenta' : 'Inicia sesión'}</h1>
          <p className="muted">{registering
            ? 'Registra tus datos para crear tu cuenta ciudadana.'
            : 'Ingresa con tu nombre de usuario y contraseña.'}</p>
        </div>
        <form key={mode} onSubmit={submit}>
          {registering ? <RegistrationFields /> : (
            <>
              <Field label="Nombre de usuario" name="usuario" autoComplete="username" autoCapitalize="none" maxLength={100} />
              <Field label="Contraseña" name="password" type="password" autoComplete="current-password" maxLength={128} />
            </>
          )}
          {error && <p className="message error" role="alert">{error}</p>}
          <button className="primary access-submit" disabled={busy}>{busy ? 'Procesando…' : registering ? 'Crear cuenta' : 'Entrar'}</button>
        </form>
        <button className="text-button" type="button" disabled={busy} onClick={switchMode}>
          {registering ? 'Volver al inicio de sesión' : 'Crear cuenta ciudadana'}
        </button>
      </section>
    </main>
  );
}
