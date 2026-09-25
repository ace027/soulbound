import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import AccessGate from './components/AccessGate';
import ModeGate from './components/ModeGate';
import { takeSignInParams } from './lib/authClient';
import './index.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('#root element not found in index.html');
}

// Hosted mode (Phase 6): take the invite code (`#invite=`) and Better Auth's
// `?error=` out of the address bar BEFORE the first render or fetch, for every
// visitor, signed in or not. They are held in memory and passed to ModeGate;
// the code never stays in the URL or the history entry.
const signInParams = takeSignInParams();

// An invite link opened in a tab already showing the app (e.g. pasted into the
// sign-in screen) changes only the fragment, which does not reload the page,
// so the line above would never see it and the code would stay in the bar.
// Reloading runs it again: the code is stripped and redeemed as usual.
window.addEventListener('hashchange', () => {
  if (/[#&]invite=/.test(window.location.hash)) window.location.reload();
});

// AccessGate (Phase 5, R19) checks the deployer's passphrase before the title
// screen, without touching App.tsx. StrictMode runs the mount effect twice in
// dev, so a dev page load makes two GET /api/access calls — harmless
// (AccessGate.tsx docstring).
//
// ModeGate (Phase 6) wraps it: it makes its own GET /api/access first and, in
// hosted mode, shows sign-in on a 401 SIGN_IN_REQUIRED, which AccessGate would
// otherwise fail open on. In self-host it renders AccessGate unchanged, so a
// self-host page load now makes two access calls (four in dev under
// StrictMode, whose doubled mount effect applies to ModeGate too).
createRoot(rootElement).render(
  <StrictMode>
    <ModeGate signInParams={signInParams}>
      <AccessGate>
        <App />
      </AccessGate>
    </ModeGate>
  </StrictMode>,
);
