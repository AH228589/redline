import { mark } from './lib/earlyprobe'
import { render } from 'preact'
import './index.css'
import { App } from './app'
import { loadAll, routes } from './lib/store'
import { autoResume } from './lib/recorder'
import { go } from './lib/router'
import { checkForUpdate, isNative, nativePlatform } from './lib/native'

if (isNative) document.documentElement.classList.add('native', nativePlatform)
mark('modules')
render(<App />, document.getElementById('app')!)
mark('render')
loadAll().then(async () => {
  mark('loadAll')
  if (await autoResume(routes.value)) go('/record', true)
  mark('autoResume')
})
checkForUpdate().then(() => mark('checkForUpdate'))

// The website and the iPhone app (which loads the site over https) use the service
// worker for offline starts. The Android app ships its files inside the package.
if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:' && location.hostname !== 'localhost') {
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
