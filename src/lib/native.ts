// Bridges to the installed app (Capacitor). On the website these are all no-ops.
import { Capacitor, registerPlugin } from '@capacitor/core'
import type { BackgroundGeolocationPlugin } from '@capacitor-community/background-geolocation'
import { signal } from '@preact/signals'

export const isNative = Capacitor.isNativePlatform()
export const nativePlatform = Capacitor.getPlatform() as 'android' | 'ios' | 'web'
export const PUBLIC_URL = 'https://redline-two-mu.vercel.app/'
export const APP_VERSION = __APP_VERSION__

const BG = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation')

export interface NativeFix {
  lat: number
  lon: number
  acc: number
  alt: number | null
  speed: number | null
  heading: number | null
  t: number
}

let watcherId: string | null = null
let watcherBg = false
let pending: Promise<void> = Promise.resolve()

/**
 * Watch location through the native plugin. With `background` the OS keeps the
 * updates coming while the phone is locked (a "Recording" notification on Android).
 */
export function nativeWatch(background: boolean, onFix: (f: NativeFix) => void, onError: (msg: string) => void) {
  pending = pending.then(async () => {
    if (watcherId && watcherBg === background) return
    await removeWatcher()
    watcherBg = background
    watcherId = await BG.addWatcher(
      {
        backgroundMessage: background ? 'Recording your activity. Tap to open Redline.' : undefined,
        backgroundTitle: 'Redline is recording',
        requestPermissions: true,
        stale: false,
        distanceFilter: 0,
      },
      (loc, err) => {
        if (err) {
          if (err.code === 'NOT_AUTHORIZED') onError('Location permission is off. Open settings and allow location for Redline.')
          return
        }
        if (!loc) return
        onFix({ lat: loc.latitude, lon: loc.longitude, acc: loc.accuracy, alt: loc.altitude, speed: loc.speed, heading: loc.bearing, t: loc.time ?? Date.now() })
      },
    )
  })
  return pending
}

async function removeWatcher() {
  if (!watcherId) return
  const id = watcherId
  watcherId = null
  await BG.removeWatcher({ id }).catch(() => {})
}

export function nativeStop() {
  pending = pending.then(removeWatcher)
  return pending
}

export const openAppSettings = () => BG.openSettings()

/** Android 13+ hides the "Recording" notification unless notifications are allowed. */
export async function askNotificationPermission() {
  if (nativePlatform !== 'android') return
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications')
    const st = await LocalNotifications.checkPermissions()
    if (st.display !== 'granted') await LocalNotifications.requestPermissions()
  } catch {
    /* recording still works without the notification */
  }
}

export async function nativeSpeak(text: string) {
  const { TextToSpeech } = await import('@capacitor-community/text-to-speech')
  await TextToSpeech.speak({ text, lang: 'en-US', rate: 1.0, category: 'playback' })
}

/** Save a file the native way: write it to the cache and open the share sheet. */
export async function nativeSave(name: string, data: string | Uint8Array) {
  const { Filesystem, Directory, Encoding } = await import('@capacitor/filesystem')
  const { Share } = await import('@capacitor/share')
  const res =
    typeof data === 'string'
      ? await Filesystem.writeFile({ path: name, data, directory: Directory.Cache, encoding: Encoding.UTF8 })
      : await Filesystem.writeFile({ path: name, data: toBase64(data), directory: Directory.Cache })
  await Share.share({ title: name, files: [res.uri] })
}

function toBase64(bytes: Uint8Array) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

// ---------- app updates ----------
export const appUpdate = signal<{ version: string; url: string } | null>(null)

const newer = (a: string, b: string) => {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0)
  return false
}

export async function checkForUpdate() {
  if (!isNative) return
  try {
    const res = await fetch(`${PUBLIC_URL}app-version.json`, { cache: 'no-store' })
    if (!res.ok) return
    const j = (await res.json()) as { version: string; apk?: string; ipa?: string }
    const file = nativePlatform === 'android' ? j.apk : j.ipa
    if (file && newer(j.version, APP_VERSION)) appUpdate.value = { version: j.version, url: new URL(file, PUBLIC_URL).href }
  } catch {
    /* offline */
  }
}

/** Open a link outside the app (system browser). */
export function openExternal(url: string) {
  if (isNative) window.location.href = url
  else window.open(url, '_blank', 'noopener')
}
