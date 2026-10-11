import { render } from 'preact'
import './index.css'
import { App } from './app'
import { loadAll } from './lib/store'
import { checkForUpdate, isNative, nativePlatform } from './lib/native'

if (isNative) document.documentElement.classList.add('native', nativePlatform)
render(<App />, document.getElementById('app')!)
loadAll()
checkForUpdate()

// The installed app ships its files inside the package, so only the website needs the service worker.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

if (import.meta.env.DEV) {
  // Test hooks for local development only.
  import('./lib/devtools').then((m) => m.install())
}
