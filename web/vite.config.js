import { defineConfig } from 'vite';

// base './' so the built console works from any static host or subfolder.
export default defineConfig({ base: './', server: { port: 5173 } });
