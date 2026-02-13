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
  },
  build: {
    outDir: path.resolve(__dirname, 'client/dist'),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          codemirror: [
            'codemirror',
            '@codemirror/state',
            '@codemirror/language',
            '@codemirror/autocomplete',
            '@codemirror/lint',
            '@codemirror/legacy-modes/mode/stex',
          ],
          pdfjs: ['pdfjs-dist'],
          collab: ['yjs', 'y-codemirror.next', '@hocuspocus/provider'],
          markdown: ['marked'],
        },
      },
    },
  },
})
