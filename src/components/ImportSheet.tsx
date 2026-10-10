import { useRef, useState } from 'preact/hooks'
import { Icon } from './Icon'
import { Progress, Sheet } from './ui'
import { importFiles, type ImportResult } from '../lib/importers'
import { notify } from '../lib/store'

export function ImportSheet({ onClose }: { onClose: () => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState<{ done: number; total: number; label: string } | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)

  async function run(files: File[]) {
    if (!files.length) return
    setResult(null)
    setBusy({ done: 0, total: files.length, label: 'Reading files' })
    try {
      const r = await importFiles(files, (done, total, label) => setBusy({ done, total, label }))
      setResult(r)
      notify(`Imported ${r.added} ${r.added === 1 ? 'activity' : 'activities'}${r.routes ? ` and ${r.routes} route${r.routes > 1 ? 's' : ''}` : ''}`)
    } catch (e) {
      notify(`Import failed: ${(e as Error).message}`)
    } finally {
      setBusy(null)
    }
  }

  return (
    <Sheet title="Import activities" onClose={onClose}>
      <div class="col">
        <div
          class={`drop ${over ? 'over' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            run(Array.from(e.dataTransfer?.files || []))
          }}
        >
          <Icon name="upload" size={2} />
          <p style={{ margin: '0.5rem 0 0.75rem', fontWeight: 650 }}>Drop files here</p>
          <button class="btn primary" disabled={!!busy} onClick={() => input.current?.click()}>
            Choose files
          </button>
          <p class="small muted" style={{ marginTop: '0.75rem' }}>
            GPX, TCX, FIT (also .gz) or a whole export .zip
          </p>
          <input
            ref={input}
            type="file"
            multiple
            accept=".gpx,.tcx,.fit,.gz,.zip,application/gpx+xml,application/zip"
            class="hidden"
            onChange={(e) => {
              const f = Array.from((e.target as HTMLInputElement).files || [])
              ;(e.target as HTMLInputElement).value = ''
              run(f)
            }}
          />
        </div>

        {busy && (
          <div class="col" style={{ gap: '0.4rem' }}>
            <div class="row between small">
              <span class="ink2" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {busy.label}
              </span>
              <span class="num muted">
                {busy.done} / {busy.total}
              </span>
            </div>
            <Progress value={busy.total ? busy.done / busy.total : 0} />
          </div>
        )}

        {result && (
          <div class="notice">
            <Icon name="check" />
            <div>
              <b>{result.added}</b> added, {result.skipped} already here{result.routes ? `, ${result.routes} routes` : ''}.
              {result.failed.length > 0 && (
                <div class="tiny" style={{ marginTop: '0.25rem' }}>
                  Could not read: {result.failed.slice(0, 5).join(', ')}
                  {result.failed.length > 5 ? ` and ${result.failed.length - 5} more` : ''}
                </div>
              )}
            </div>
          </div>
        )}

        <div class="section-title" style={{ marginTop: '0.5rem' }}>
          Bring your history over
        </div>
        <div class="notice">
          <Icon name="info" />
          <div>
            Coming from Strava? On the website open <b>Settings, My Account, Download or Delete Your Account</b> and request your archive. Drop the zip here when it arrives: activities, names and descriptions all come across.
          </div>
        </div>
        <div class="notice">
          <Icon name="info" />
          <div>
            Garmin, Coros, Suunto, Polar and Wahoo all export FIT or GPX files. GPX files without timestamps are saved as routes.
          </div>
        </div>
      </div>
    </Sheet>
  )
}
