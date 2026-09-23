import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AccessGate from './components/AccessGate';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element not found in index.html');
}

// AccessGate (Phase 5, R19) checks the deployer's passphrase before the title
// screen, without touching App.tsx. StrictMode runs the mount effect twice in
// dev, so a dev page load makes two GET /api/access calls — harmless
// (AccessGate.tsx docstring).
createRoot(rootElement).render(
  <StrictMode>
    <AccessGate>
      <App />
    </AccessGate>
  </StrictMode>,
);
