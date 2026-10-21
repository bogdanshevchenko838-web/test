import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig(({ mode }) => ({
  plugins: mode === 'offline' ? [viteSingleFile()] : [],
  build: mode === 'offline' ? { outDir: 'dist-offline' } : undefined,
  // Prebundle worker dependencies too, so the first upload does not reload the UI.
  optimizeDeps: { include: ['fft.js', 'semver', 'papaparse', 'react', 'react-dom/client'] },
}));
