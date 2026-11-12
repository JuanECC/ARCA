import ArcaProteccionCivil from './ArcaProteccionCivil';

// App.jsx ya pasa onLogout y profile; no se modifica Firebase Auth.
export default function CivilProtection(props) {
  return <ArcaProteccionCivil {...props} />;
}
