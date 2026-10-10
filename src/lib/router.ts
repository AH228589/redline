import { signal } from '@preact/signals'

const parse = () => {
  const h = location.hash.replace(/^#/, '') || '/'
  const [path, q = ''] = h.split('?')
  return { path, parts: path.split('/').filter(Boolean), query: new URLSearchParams(q) }
}

export const route = signal(parse())

window.addEventListener('hashchange', () => {
  route.value = parse()
  window.scrollTo(0, 0)
})

export function go(path: string, replace = false) {
  const h = `#${path}`
  if (replace) {
    history.replaceState(null, '', h)
    route.value = parse()
  } else location.hash = path
}

export function back(fallback = '/') {
  if (history.length > 1) history.back()
  else go(fallback)
}
