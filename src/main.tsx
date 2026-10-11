import { render } from 'preact'
import './index.css'
import { App } from './app'
import { loadAll, routes } from './lib/store'
import { autoResume } from './lib/recorder'
import { go } from './lib/router'
import { checkForUpdate, isNative, nativePlatform } from './lib/native'

if (isNative) document.documentElement.classList.add('native', nativePlatform)
render(<App />, document.getElementById('app')!)
loadAll().then(async () => {
  if (await autoResume(routes.value)) go('/record', true)
})
checkForUpdate()

// The installed app ships its files inside the package, so only the website needs the service worker.
if ('serviceWorker' in navigator && import.meta.env.PROD && !isNative) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}))
}

if (import.meta.env.VITE_AUTOTEST === '1') {
  // CI simulator/emulator builds only. Log errors as text; native consoles print Error objects as {}.
  window.addEventListener('error', (e) => console.log(`[AUTOTEST] error ${JSON.stringify({ msg: e.message, src: e.filename, line: e.lineno, col: e.colno, stack: e.error?.stack })}`))
  window.addEventListener('unhandledrejection', (e) => console.log(`[AUTOTEST] rejection ${JSON.stringify({ reason: String(e.reason), stack: e.reason?.stack })}`))
  import('./lib/autotest').then((m) => setTimeout(m.runAutotest, 1500))
}

if (import.meta.env.DEV) {
  // Test hooks for local development only.
  import('./lib/devtools').then((m) => m.install())
}
