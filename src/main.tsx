import { render } from 'preact'
import './index.css'
import { App } from './app'
import { loadAll } from './lib/store'

render(<App />, document.getElementById('app')!)
loadAll()

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

if (import.meta.env.DEV) {
  // Test hooks for local development only.
  import('./lib/devtools').then((m) => m.install())
}
