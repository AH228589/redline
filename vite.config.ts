import preact from '@preact/preset-vite'
import { readFileSync } from 'node:fs'
import { defineConfig } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  plugins: [preact()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  server: { port: 5198, strictPort: true },
  preview: { port: 5198 },
  build: { chunkSizeWarningLimit: 1500 },
})
