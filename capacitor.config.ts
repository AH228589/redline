import type { CapacitorConfig } from '@capacitor/cli'

// The iPhone app loads Redline from its https address: WebKit will not start
// web workers (which the map needs) on the app's own capacitor:// origin.
// CAP_SERVER_URL is set when syncing iOS (and by device tests, to a local server).
const remote = process.env.CAP_SERVER_URL
const PUBLIC_HOST = 'redline-two-mu.vercel.app'
const appBound = !!remote && new URL(remote).hostname === PUBLIC_HOST

const config: CapacitorConfig = {
  appId: 'dev.ahristov.redline',
  appName: 'Redline',
  webDir: 'dist',
  ...(remote ? { server: { url: remote, errorPath: 'offline.html' } } : {}),
  android: {
    // Keeps location callbacks flowing to the web layer after 5 minutes in the background.
    useLegacyBridge: true,
  },
  ios: {
    contentInset: 'never',
    // App-bound domains let the web view run the service worker, so the app
    // still opens without signal after the first launch.
    limitsNavigationsToAppBoundDomains: appBound,
  },
}

export default config
