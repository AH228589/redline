import { useEffect } from 'preact/hooks'
import { Icon, Logo } from './components/Icon'
import { ImportSheet } from './components/ImportSheet'
import { UpdateBanner } from './components/GetApp'
import { ManualSheet } from './components/ManualSheet'
import { route } from './lib/router'
import { showImport, showManual } from './lib/uiState'
import { ready, settings, toast } from './lib/store'
import { Home } from './views/Home'
import { ActivityView } from './views/Activity'
import { RecordView } from './views/Record'
import { MapsView } from './views/Maps'
import { RouteBuilder } from './views/RouteBuilder'
import { SegmentView } from './views/SegmentDetail'
import { TrainingView } from './views/Training'
import { YouView } from './views/You'
import { BeaconView } from './views/Beacon'


const NAV = [
  { href: '/', label: 'Home', icon: 'home', match: (p: string) => p === '/' || p.startsWith('/activity') },
  { href: '/maps', label: 'Maps', icon: 'map', match: (p: string) => p.startsWith('/maps') || p.startsWith('/route') || p.startsWith('/segment') },
  { href: '/record', label: 'Record', icon: 'record', rec: true, match: (p: string) => p.startsWith('/record') },
  { href: '/training', label: 'Training', icon: 'training', match: (p: string) => p.startsWith('/training') },
  { href: '/you', label: 'You', icon: 'user', match: (p: string) => p.startsWith('/you') },
]

function applyTheme() {
  const t = settings.value.theme
  if (t === 'system') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = t
  const dark = t === 'dark' || (t === 'system' && matchMedia('(prefers-color-scheme: dark)').matches)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#0d0d0d' : '#f4f4f1')
}

export function App() {
  const { path, parts } = route.value
  useEffect(applyTheme, [settings.value.theme])

  if (!ready.value)
    return (
      <div style={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', color: 'var(--muted)' }}>
        <div class="brand">
          <span class="brand-mark">
            <Logo />
          </span>
          Redline
        </div>
      </div>
    )

  if (parts[0] === 'beacon' && parts[1]) return <BeaconView id={parts[1]} />

  let view
  let full = false
  switch (parts[0]) {
    case 'activity':
      view = <ActivityView id={parts[1]} />
      break
    case 'record':
      view = <RecordView />
      full = true
      break
    case 'maps':
      view = <MapsView tab={(parts[1] as 'heatmap' | 'routes' | 'segments') || 'heatmap'} />
      break
    case 'route':
      view = <RouteBuilder id={parts[1] === 'new' ? null : parts[1]} />
      full = true
      break
    case 'segment':
      view = <SegmentView id={parts[1]} />
      break
    case 'training':
      view = <TrainingView tab={(parts[1] as 'fitness') || 'fitness'} />
      break
    case 'you':
      view = <YouView />
      break
    default:
      view = <Home />
  }

  return (
    <div class="shell">
      <nav class="sidenav" aria-label="Main">
        <a href="#/" class="brand">
          <span class="brand-mark">
            <Logo />
          </span>
          Redline
        </a>
        {NAV.map((n) => (
          <a key={n.href} href={`#${n.href}`} class={`${n.match(path) ? 'active' : ''} ${n.rec ? 'rec' : ''}`}>
            <Icon name={n.icon} fill={n.rec} />
            {n.rec ? 'Record' : n.label}
          </a>
        ))}
        <div style={{ flex: 1 }} />
        <button class="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => (showImport.value = true)}>
          <Icon name="upload" /> Import files
        </button>
        <button class="btn ghost" style={{ justifyContent: 'flex-start' }} onClick={() => (showManual.value = true)}>
          <Icon name="plus" /> Add manual entry
        </button>
      </nav>
      <div style={{ minWidth: 0 }}>
        {!full && (
          <header class="topbar">
            <a href="#/" class="brand">
              <span class="brand-mark">
                <Logo />
              </span>
              Redline
            </a>
            <div class="grow" />
            <button class="btn sm" onClick={() => (showImport.value = true)} aria-label="Import files">
              <Icon name="upload" size={1} /> Import
            </button>
            <button class="btn sm icon" onClick={() => (showManual.value = true)} aria-label="Add manual entry">
              <Icon name="plus" size={1} />
            </button>
          </header>
        )}
        <main class={`main ${full ? 'full' : ''}`}>
          {!full && <UpdateBanner />}
          {view}
        </main>
      </div>
      {!full && (
        <nav class="bottomnav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.href} href={`#${n.href}`} class={`navitem ${n.match(path) ? 'active' : ''} ${n.rec ? 'rec' : ''}`}>
              {n.rec ? (
                <span class="navdot">
                  <Icon name="record" fill size={1.4} />
                </span>
              ) : (
                <Icon name={n.icon} size={1.35} />
              )}
              {n.label}
            </a>
          ))}
        </nav>
      )}
      {showImport.value && <ImportSheet onClose={() => (showImport.value = false)} />}
      {showManual.value && <ManualSheet onClose={() => (showManual.value = false)} />}
      {toast.value && (
        <div class="toast" key={toast.value.id} role="status">
          {toast.value.text}
        </div>
      )}
    </div>
  )
}
