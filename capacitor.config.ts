import type { CapacitorConfig } from '@capacitor/cli'

// Device tests can point the app at a hosted page instead of the bundled files.
const remote = process.env.CAP_SERVER_URL

const config: CapacitorConfig = {
  appId: 'dev.ahristov.redline',
  appName: 'Redline',
  webDir: 'dist',
  ...(remote ? { server: { url: remote } } : {}),
  android: {
    // Keeps location callbacks flowing to the web layer after 5 minutes in the background.
    useLegacyBridge: true,
  },
  ios: {
    contentInset: 'never',
  },
}

export default config
