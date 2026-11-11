import { useCallback, useEffect, useState } from 'react';
import { RegistrationFields } from '../auth/AuthPage';
import { accountError, callAccount } from '../auth/firebase';
import { roleLabels } from '../auth/roles';

export default function AdminPanel() {
  const [accounts, setAccounts] = useState(null);
  const [next, setNext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [formError, setFormError] = useState('');
  const [created, setCreated] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async (cursor) => {
    setLoading(true);
    setListError('');
    try {
      const result = await callAccount('listAccounts', { cursor: cursor ?? null });
      setAccounts((previous) => cursor ? [...previous, ...result.accounts] : result.accounts);
      setNext(result.next);
    } catch (error) {
      setListError(accountError(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function create(event) {
    event.preventDefault();
    const form = event.currentTarget;
    setSaving(true);
    setFormError('');
    setCreated('');
    try {
      const data = Object.fromEntries(new FormData(form));
      const result = await callAccount('createManagedAccount', data);
      setCreated(result.email);
      form.reset();
      await load();
    } catch (error) {
      setFormError(accountError(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="admin-grid">
      <section className="card">
        <h2>Crear cuenta</h2>
        <form onSubmit={create}>
          <label className="field">
            <span className="field__label">Rol</span>
            <select className="input" name="role" defaultValue="" required>
              <option value="" disabled>Selecciona un rol</option>
              <option value="citizen">Ciudadanía</option>
              <option value="water-operator">Operación de Agua</option>
              <option value="maintenance-crew">Cuadrilla de mantenimiento</option>
              <option value="civil-protection">Protección Civil</option>
            </select>
          </label>
          <RegistrationFields />
          {formError && <p className="message error" role="alert">{formError}</p>}
          {created && <p className="message success" role="status">Usuario creado: <strong>{created}</strong></p>}
          <button className="primary" disabled={saving || loading}>{saving ? 'Creando…' : 'Crear cuenta'}</button>
        </form>
      </section>
      <section className="card">
        <h2>Cuentas registradas</h2>
        {loading && <p role="status">Cargando cuentas…</p>}
        {listError && <p className="message error" role="alert">{listError}</p>}
        {listError && <button className="text-button" onClick={() => load()}>Volver a cargar</button>}
        {!loading && accounts?.length === 0 && <p>Sin cuentas registradas.</p>}
        {!!accounts?.length && (
          <ul className="account-list">
            {accounts.map((account) => (
              <li key={account.uid}>
                <strong>{account.nombre || account.email}</strong>
                <span className="muted">{account.email} · {roleLabels[account.role]}</span>
              </li>
            ))}
          </ul>
        )}
        {next && <button className="text-button" disabled={loading} onClick={() => load(next)}>Cargar más cuentas</button>}
      </section>
    </div>
  );
}
