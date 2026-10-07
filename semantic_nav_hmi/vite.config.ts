import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative asset URLs: the build works from any path (hmi_server, file share, sub-path proxy)
  base: './',
  server: {
    port: 5173,
    host: true, // reachable from tablets on the robot LAN
  },
  preview: {
    port: 4173,
    host: true,
  },
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1500,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
