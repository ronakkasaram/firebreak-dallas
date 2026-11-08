import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// base './' so the build works from any static host or subfolder.
// Two pages: the product site (index.html) and the console (app.html).
export default defineConfig({
  base: './',
  server: { port: 5173 },
  build: { rollupOptions: { input: { site: resolve(__dirname, 'index.html'), app: resolve(__dirname, 'app.html') } } },
});
