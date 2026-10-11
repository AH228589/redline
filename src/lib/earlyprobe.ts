// Autotest builds only: find out at which point during start-up the page stops
// being able to start web workers. Logs milestone times and worker probes.
const T0 = performance.now()
export const mark = (label: string) => {
  if (import.meta.env.VITE_AUTOTEST === '1') console.log(`[AUTOTEST] mark ${label} at ${Math.round(performance.now() - T0)} ms`)
}

if (import.meta.env.VITE_AUTOTEST === '1') {
  const src = URL.createObjectURL(new Blob(['self.onmessage = (e) => self.postMessage(e.data); self.postMessage("up")'], { type: 'text/javascript' }))
  const probe = (label: string) => {
    const t = performance.now()
    let done = false
    try {
      const w = new Worker(src)
      w.onmessage = () => {
        if (done) return
        done = true
        console.log(`[AUTOTEST] probe ${label}: new worker ok in ${Math.round(performance.now() - t)} ms`)
        w.terminate()
      }
      setTimeout(() => !done && console.log(`[AUTOTEST] probe ${label}: new worker TIMEOUT`), 5000)
    } catch (e) {
      console.log(`[AUTOTEST] probe ${label}: throw ${String(e)}`)
    }
  }
  // A long-lived worker to see whether existing workers keep talking.
  const keeper = new Worker(src)
  let pings = 0
  keeper.onmessage = (e) => {
    if (e.data !== 'up') console.log(`[AUTOTEST] keeper echo ${e.data}`)
  }
  for (const s of [0, 1, 2, 3, 4, 5, 6, 8, 10]) {
    setTimeout(() => {
      probe(`${s}s`)
      keeper.postMessage(`ping${++pings}@${s}s`)
    }, s * 1000)
  }
}
