import { createRoot } from 'react-dom/client';
import App from './App';
import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/forms.css';
import '../styles/utilities.css';
import '../styles/access.css';

createRoot(document.getElementById('root')).render(<App />);
