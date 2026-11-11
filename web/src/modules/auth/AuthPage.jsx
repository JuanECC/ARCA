import { useState } from 'react';
import { accountError, callAccount, login } from './firebase';

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
      <Field label="Correo electrónico" name="email" type="email" autoComplete="email" maxLength={254} />
      <Field label="Contraseña (mínimo 8 caracteres)" name="password" type="password"
        autoComplete="new-password" minLength={8} maxLength={128} />
    </>
  );
}

export default function AuthPage() {
  const [mode, setMode] = useState('login');
  const [username, setUsername] = useState('');
  const [created, setCreated] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const registering = mode === 'register';

  function switchMode() {
    setMode(registering ? 'login' : 'register');
    setError('');
    setCreated('');
  }

  async function submit(event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true);
    setError('');
    try {
      if (registering) {
        const result = await callAccount('registerCitizen', data);
        setCreated(result.username);
        setUsername(result.username);
        setMode('login');
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
    <main className="access-layout">
      <section className="access-intro" aria-label="HidroAlerta Veracruz">
        <span className="access-brand">ARCA · Veracruz</span>
        <p className="access-title">HidroAlerta <br />Veracruz</p>
        <p>Del reporte ciudadano a la acción preventiva.</p>
      </section>
      <section className="card access-card" aria-labelledby="access-title">
        <h1 id="access-title">{registering ? 'Crea tu cuenta' : 'Inicia sesión'}</h1>
        <p className="muted">{registering
          ? 'Regístrate con tu correo. Generaremos el usuario que usarás para entrar.'
          : 'Ingresa con tu nombre de usuario y contraseña.'}</p>
        {created && <p className="message success" role="status">Guarda tu usuario: <strong>{created}</strong></p>}
        <form key={mode} onSubmit={submit}>
          {registering ? (
            <>
              <label className="field">
                <span className="field__label">Rol</span>
                <select className="input" name="role"><option value="citizen">Ciudadanía</option></select>
              </label>
              <p className="muted small">Las cuentas de Operación de Agua y Protección Civil se crean desde Administración.</p>
              <RegistrationFields />
            </>
          ) : (
            <>
              <Field label="Nombre de usuario" name="username" autoComplete="username" autoCapitalize="none"
                spellCheck={false} maxLength={40} value={username} onChange={(event) => setUsername(event.target.value)} />
              <Field label="Contraseña" name="password" type="password" autoComplete="current-password" maxLength={128} />
            </>
          )}
          {error && <p className="message error" role="alert">{error}</p>}
          <button className="primary" disabled={busy}>{busy ? 'Procesando…' : registering ? 'Crear cuenta' : 'Entrar'}</button>
        </form>
        <button className="text-button" type="button" disabled={busy} onClick={switchMode}>
          {registering ? 'Volver al inicio de sesión' : 'Crear cuenta ciudadana'}
        </button>
      </section>
    </main>
  );
}
