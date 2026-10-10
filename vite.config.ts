import preact from '@preact/preset-vite'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [preact()],
  server: { port: 5198, strictPort: true },
  preview: { port: 5198 },
  build: { chunkSizeWarningLimit: 1500 },
})
