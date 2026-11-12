import { useEffect, useRef, useState } from 'react';
import './CitizenProfile.css';
import { isCitizenProfileComplete } from './profileService';
import { auth } from '../auth/firebase';
import { collection, getFirestore, onSnapshot, query, where } from 'firebase/firestore';

const emptyForm = {
  address: '',
  zone: '',
  sectorId: '',
  zipCode: '',
  phone: '',
  receiveAlerts: true,
};

export default function CitizenProfile({ profile, account, onClose, onSave }) {
  const [form, setForm] = useState(emptyForm);
  const [sectors, setSectors] = useState([]);
  useEffect(() => {
    if (!auth?.app) return;
    return onSnapshot(query(collection(getFirestore(auth.app), 'sectors'), where('active','==',true)), snap => {
      setSectors(snap.docs.map(d => ({ id:d.id, ...d.data() })).filter(s => s.active !== false));
    });
  }, []);
  const [saving, setSaving] = useState(false);
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState('');
  const previewUrl = useRef(null);
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setPhotoFile(null);
    setPhotoPreview(profile?.fotoBase64 || '');
    setForm({
      address: profile?.address ?? '',
      zone: profile?.zone ?? '',
      sectorId: profile?.sectorId ?? '',
      zipCode: profile?.zipCode ?? '',
      phone: profile?.phone ?? '',
      receiveAlerts: profile?.receiveAlerts ?? true,
    });
  }, [profile]);

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') onClose?.();
    }

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose]);

  function updateField(event) {
    const { name, value, type, checked } = event.target;
    setForm((current) => ({
      ...current,
      [name]: type === 'checkbox' ? checked : value,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    try {
      if (!onSave) {
        throw new Error('Falta conectar la función para guardar el perfil.');
      }
      await onSave(form, photoFile, profile?.fotoBase64 || null);
      setSuccess('Tu perfil se actualizó correctamente.');
    } catch (failure) {
      setError(failure?.message || 'No se pudo guardar el perfil.');
    } finally {
      setSaving(false);
    }
  }

  const fullName = account?.nombre || 'Ciudadano';
  const email = account?.email || 'Correo no disponible';

  return (
    <div className="profile-overlay">
      <section
        className="citizen-profile"
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-title"
      >
        <header className="profile-topbar">
          <div className="profile-brand">
            <span className="material-symbols-outlined" aria-hidden="true">
              water_drop
            </span>
            <div>
              <strong>HidroAlerta Veracruz</strong>
              <span>Mi Perfil Ciudadano</span>
            </div>
          </div>

          <button
            className="profile-close"
            type="button"
            onClick={onClose}
            aria-label="Cerrar perfil"
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <main className="profile-content">
          <section className="profile-identity">
            <div className="profile-avatar" aria-hidden="true">
              {photoPreview ? <img src={photoPreview} alt="Fotografía de perfil" className="profile-avatar__photo" /> :
                <span className="material-symbols-outlined">account_circle</span>}
            </div>

            <div className="profile-identity__text">
              <span className="profile-badge">
                <span className="material-symbols-outlined" aria-hidden="true">
                  water_drop
                </span>
                Observador Ciudadano
              </span>
              <h1 id="profile-title">{fullName}</h1>
              <p>{email}</p>
              <span className="profile-status">{isCitizenProfileComplete(profile) ? 'Perfil completo' : 'Perfil incompleto'}</span>
            </div>
          </section>

          <aside className="profile-notice">
            <span className="material-symbols-outlined" aria-hidden="true">
              info
            </span>
            <div>
              <strong>Completa tu información cívica</strong>
              <p>
                Agrega tu zona y teléfono para facilitar el envío de alertas
                hidrometeorológicas relevantes.
              </p>
            </div>
          </aside>

          <form className="profile-form" onSubmit={submit}>
            <section className="profile-card">
              <div className="profile-card__heading"><span className="material-symbols-outlined">photo_camera</span><h2>Fotografía de perfil</h2></div>
              <label className="profile-field">
                <span>Subir o cambiar fotografía (opcional)</span>
                <input type="file" accept="image/*" onChange={event => {
                  const file = event.target.files?.[0] || null;
                  if (!file) return;
                  setPhotoFile(file);
                  if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
                  const url = URL.createObjectURL(file);
                  previewUrl.current = url;
                  setPhotoPreview(url);
                }} />
                <small>Se comprime a WebP y se guarda en tu perfil. No usamos Firebase Storage.</small>
              </label>
            </section>
            <section className="profile-card">
              <div className="profile-card__heading">
                <span className="material-symbols-outlined" aria-hidden="true">
                  badge
                </span>
                <h2>Datos de cuenta</h2>
                <span className="profile-locked">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    lock
                  </span>
                  Protegidos
                </span>
              </div>

              <label className="profile-field">
                <span>Nombre completo</span>
                <input value={fullName} readOnly />
              </label>

              <label className="profile-field">
                <span>Correo electrónico</span>
                <input type="email" value={email} readOnly />
              </label>
            </section>

            <section className="profile-card profile-card--highlight">
              <div className="profile-card__heading">
                <span className="material-symbols-outlined" aria-hidden="true">
                  add_location_alt
                </span>
                <h2>Zona y contacto de urgencia</h2>
              </div>

              <label className="profile-field" htmlFor="profile-address">
                <span>Dirección de residencia o predio *</span>
                <span className="profile-input-wrap">
                  <span className="material-symbols-outlined" aria-hidden="true">
                    location_on
                  </span>
                  <input
                    id="profile-address"
                    name="address"
                    value={form.address}
                    onChange={updateField}
                    placeholder="Calle, número y colonia"
                    required
                  />
                </span>
                <small>
                  Tu dirección ayuda a los equipos de auxilio en caso de
                  inundación.
                </small>
              </label>

              <label className="profile-field" htmlFor="profile-zone">
                <span>Sector o zona hidrográfica *</span>
                <select
                  id="profile-zone"
                  name="zone"
                  value={form.zone}
                  onChange={updateField}
                  required
                >
                  <option value="">Selecciona tu zona</option>
                  <option value="centro">Zona Centro</option>
                  <option value="norte">Zona Norte</option>
                  <option value="sur">Zona Sur</option>
                  <option value="poniente">Zona Poniente</option>
                  <option value="rural">Zona Rural</option>
                </select>
              </label>

              <label className="profile-field" htmlFor="profile-sector">
                <span>Sector de abastecimiento de agua *</span>
                <select id="profile-sector" name="sectorId" value={form.sectorId} onChange={updateField} required>
                  <option value="">Selecciona el sector de tu colonia</option>
                  {sectors.map(s => <option key={s.id} value={s.id}>{s.name} · {s.colonias}</option>)}
                </select>
                <small>El calendario y los avisos se filtran por el sector seleccionado, no solo por la zona general.</small>
              </label>

              <div className="profile-field-grid">
                <label className="profile-field" htmlFor="profile-zip">
                  <span>Código postal *</span>
                  <input
                    id="profile-zip"
                    name="zipCode"
                    value={form.zipCode}
                    onChange={updateField}
                    inputMode="numeric"
                    maxLength={5}
                    pattern="[0-9]{5}"
                    placeholder="91700"
                    required
                  />
                </label>

                <label className="profile-field" htmlFor="profile-phone">
                  <span>Teléfono de alerta *</span>
                  <input
                    id="profile-phone"
                    name="phone"
                    type="tel"
                    value={form.phone}
                    onChange={updateField}
                    placeholder="+52 229 000 0000"
                    required
                  />
                </label>
              </div>

              <label className="profile-alert-option">
                <input
                  name="receiveAlerts"
                  type="checkbox"
                  checked={form.receiveAlerts}
                  onChange={updateField}
                />
                <span>
                  <strong>Recibir alertas urgentes por SMS o WhatsApp</strong>
                  <small>
                    Puedes cambiar esta preferencia cuando actualices tu perfil.
                  </small>
                </span>
              </label>
            </section>

            {error && (
              <p className="profile-message profile-message--error" role="alert">
                {error}
              </p>
            )}

            {success && (
              <p
                className="profile-message profile-message--success"
                role="status"
              >
                {success}
              </p>
            )}

            <button className="profile-save" type="submit" disabled={saving}>
              <span className="material-symbols-outlined" aria-hidden="true">
                task_alt
              </span>
              {saving ? 'Guardando…' : 'Guardar y actualizar perfil'}
            </button>

            <p className="profile-privacy">
              Tus datos se usan para gestionar alertas ciudadanas.
            </p>
          </form>
        </main>
      </section>
    </div>
  );
}
