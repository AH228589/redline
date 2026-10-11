// Autotest builds only: start a trivial worker before any app code runs, to tell
// whether something in the app later stops workers from starting.
if (import.meta.env.VITE_AUTOTEST === '1') {
  const t0 = performance.now()
  try {
    const url = URL.createObjectURL(new Blob(['self.postMessage("hi")'], { type: 'text/javascript' }))
    const w = new Worker(url)
    w.onmessage = () => console.log(`[AUTOTEST] early-worker ok in ${Math.round(performance.now() - t0)} ms`)
    w.onerror = (e) => console.log(`[AUTOTEST] early-worker error ${e.message}`)
    setTimeout(() => console.log(`[AUTOTEST] early-worker check at 10 s`), 10000)
  } catch (e) {
    console.log(`[AUTOTEST] early-worker throw ${String(e)}`)
  }
}
export {}
