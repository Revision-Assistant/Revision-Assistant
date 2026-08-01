import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { explainDevPlugin } from './vite.explainPlugin.ts';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), explainDevPlugin()],
  envPrefix: ['VITE_', 'GEMINI_', 'GOOGLE_', 'LLM_', 'GROQ_', 'XAI_'],
});
