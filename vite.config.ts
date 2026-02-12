import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  root: 'client',
  resolve: {
    alias: { '@': path.resolve(__dirname, 'client/src') },
    dedupe: ['react', 'react-dom', 'react-router-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4092',
      '/ws': { target: 'ws://localhost:4093', ws: true },
    },
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
  build: {
    outDir: path.resolve(__dirname, 'client/dist'),
    emptyOutDir: true,
  },
})
