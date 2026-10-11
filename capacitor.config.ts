import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'dev.ahristov.redline',
  appName: 'Redline',
  webDir: 'dist',
  android: {
    // Keeps location callbacks flowing to the web layer after 5 minutes in the background.
    useLegacyBridge: true,
  },
  ios: {
    contentInset: 'never',
  },
}

export default config
