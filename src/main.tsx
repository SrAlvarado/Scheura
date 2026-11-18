import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { initUpdates } from './lib/update';
import App from './App';
import './styles/global.css';

initUpdates();

// Android/Chrome: guardar el aviso de instalación para mostrar nuestro botón "Instalar" en Bienvenida.
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  (window as unknown as { __installPrompt?: Event }).__installPrompt = e;
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
