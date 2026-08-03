import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { netlifyFunctionsDevPlugin } from './vite.explainPlugin.ts';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), netlifyFunctionsDevPlugin()],
  // Only VITE_-prefixed vars are exposed to client code (import.meta.env) — this is a
  // security boundary, not a convenience setting. Server secrets (GROQ_API_KEY etc.) must
  // never be reachable here; they belong in netlify/functions only.
  envPrefix: ['VITE_'],
});
