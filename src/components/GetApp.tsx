import { useState } from 'preact/hooks'
import { Icon } from './Icon'
import { Sheet } from './ui'
import { APP_VERSION, appUpdate, isNative, nativePlatform, openExternal, PUBLIC_URL } from '../lib/native'

type Platform = 'android' | 'ios'

const uaPlatform = (): Platform | null => (/android/i.test(navigator.userAgent) ? 'android' : /iphone|ipad|ipod/i.test(navigator.userAgent) ? 'ios' : null)

export function AppInstallSheet({ platform, onClose }: { platform: Platform; onClose: () => void }) {
  const [tab, setTab] = useState<Platform>(platform)
  return (
    <Sheet title="Get the Redline app" onClose={onClose}>
      <div class="col">
        <p class="ink2 small">
          The app records with your phone locked and in your pocket, like any running app. It is the same Redline with the same features.
        </p>
        <div class="seg" style={{ alignSelf: 'flex-start' }}>
          <button class={tab === 'android' ? 'on' : ''} onClick={() => setTab('android')}>
            Android
          </button>
          <button class={tab === 'ios' ? 'on' : ''} onClick={() => setTab('ios')}>
            iPhone
          </button>
        </div>
        {tab === 'android' ? (
          <>
            <ol class="small" style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.45rem' }}>
              <li>Download the app on your phone with the button below.</li>
              <li>Open the downloaded file. If asked, allow your browser to install apps.</li>
              <li>
                If Play Protect warns about an unknown app, tap <b>More details</b>, then <b>Install anyway</b>. It only says that because the app is not from the Play Store.
              </li>
              <li>Open Redline, start a recording and allow location access. Choose <b>Allow all the time</b> or <b>While using the app</b>; both keep recording with the screen off.</li>
            </ol>
            <a class="btn primary lg block" href={`${PUBLIC_URL}redline.apk`} download>
              <Icon name="download" /> Download for Android
            </a>
            <p class="tiny muted">
              Some phones (Xiaomi, Huawei, Samsung) stop background apps to save battery. If a recording stops while locked, set Redline's battery usage to <b>Unrestricted</b> in the app settings.
            </p>
          </>
        ) : (
          <>
            <p class="small ink2">
              Apple only allows apps from the App Store, so the iPhone app is installed from a computer with the free tool Sideloadly and your Apple ID.
            </p>
            <ol class="small" style={{ margin: 0, paddingLeft: '1.2rem', display: 'grid', gap: '0.45rem' }}>
              <li>
                On your computer, install <b>Sideloadly</b> from sideloadly.io (and iTunes on Windows).
              </li>
              <li>Download the iPhone app file below on the computer.</li>
              <li>Connect the iPhone with a cable, drop the file into Sideloadly, enter your Apple ID and press Start.</li>
              <li>
                On the iPhone, open <b>Settings, General, VPN &amp; Device Management</b> and trust your Apple ID. Turn on <b>Developer Mode</b> under Privacy &amp; Security if asked.
              </li>
              <li>With a free Apple ID the app must be refreshed in Sideloadly every 7 days. Your data stays when you refresh.</li>
            </ol>
            <a class="btn primary lg block" href={`${PUBLIC_URL}redline.ipa`} download>
              <Icon name="download" /> Download iPhone app file
            </a>
          </>
        )}
        <div class="notice">
          <Icon name="info" />
          <div>
            The app keeps its own data. To bring your activities over, use <b>You, Export backup</b> here and <b>Restore backup</b> in the app.
          </div>
        </div>
      </div>
    </Sheet>
  )
}

/** Website prompt to install the app; hidden inside the app itself. */
export function GetAppNotice({ compact }: { compact?: boolean }) {
  const [open, setOpen] = useState(false)
  if (isNative) return null
  const p = uaPlatform()
  return (
    <>
      <div class="notice" style={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Icon name="record" />
        <div class="grow">
          {compact ? (
            <>
              To record with your phone <b>locked</b>, use the Redline app.
            </>
          ) : (
            <>
              <b>Recording with your phone locked needs the app.</b> Browsers lose GPS when the screen is off. On the website, keep the screen on or use Pocket mode (the eye button).
            </>
          )}
        </div>
        <button class="btn sm primary" onClick={() => setOpen(true)}>
          <Icon name="download" size={0.9} /> Get the app
        </button>
      </div>
      {open && <AppInstallSheet platform={p ?? 'android'} onClose={() => setOpen(false)} />}
    </>
  )
}

export function UpdateBanner() {
  const u = appUpdate.value
  if (!u) return null
  return (
    <div class="notice" style={{ margin: '0 0 1rem', alignItems: 'center', background: 'var(--accent-soft)', color: 'var(--ink)' }}>
      <Icon name="download" />
      <div class="grow">
        Redline {u.version} is available (you have {APP_VERSION}).
      </div>
      {nativePlatform === 'android' ? (
        <button class="btn sm primary" onClick={() => openExternal(u.url)}>
          Update
        </button>
      ) : (
        <span class="tiny muted">Refresh it in Sideloadly</span>
      )}
      <button class="btn ghost icon sm" aria-label="Dismiss" onClick={() => (appUpdate.value = null)}>
        <Icon name="x" size={1} />
      </button>
    </div>
  )
}
