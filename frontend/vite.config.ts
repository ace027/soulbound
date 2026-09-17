import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The backend's origin from the dev server's point of view. Defaults to
// localhost for running `npm run dev` directly on the host; Docker Compose
// overrides this to the backend's service name (e.g. `http://backend:3001`)
// since containers can't reach each other via `localhost`.
const backendOrigin = process.env.BACKEND_ORIGIN ?? 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
    proxy: {
      '/api': {
        target: backendOrigin,
        changeOrigin: true,
      },
    },
  },
});
