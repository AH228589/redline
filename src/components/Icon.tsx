import type { JSX } from 'preact'

const P: Record<string, string> = {
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  map: 'M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14',
  record: 'M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0',
  training: 'M3 20h18M6 16v-5M10 16V7M14 16v-8M18 16V4',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  download: 'M12 4v12M7 11l5 5 5-5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3',
  run: 'M13 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0M7 21l3-6 3 2v4M10 15l1-5-3 1-2 3M11 10l3-2 2 3 3 1',
  trail: 'M13 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0M7 21l3-6 3 2v4M10 15l1-5-3 1-2 3M11 10l3-2 2 3 3 1M2 21l4-5 3 2',
  walk: 'M12 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0M9 21l2-6 2 2v4M11 15l1-6-3 2v3M12 9l2 3 3 1',
  hike: 'M11 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0M8 21l2-6 2 2v4M10 15l1-6-3 2v3M11 9l2 3 3 1M18 8v13',
  ride: 'M5.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M18.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M15 6a1 1 0 1 0 0-2M5.5 17.5 9 10h6l3.5 7.5M9 10l3 7.5h1M12 6l3 4',
  mtb: 'M5.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M18.5 17.5m-3.5 0a3.5 3.5 0 1 0 7 0a3.5 3.5 0 1 0-7 0M5.5 17.5 9 10h6l3.5 7.5M9 10l3 7.5M12 6l3 4M2 8l4-4 3 3',
  swim: 'M2 18c2 0 2-1.5 4-1.5S8 18 10 18s2-1.5 4-1.5 2 1.5 4 1.5 2-1.5 4-1.5M8 14l3-5 4 2 3-3M17 6a1.5 1.5 0 1 0 0-.01',
  ski: 'M14 4.5a1.5 1.5 0 1 0 3 0 1.5 1.5 0 0 0-3 0M3 18l18 3M8 19l3-6 3 1 2-4M11 13l-1-3 4-1',
  row: 'M3 18c3 0 4-1 9-1s6 1 9 1M5 14l14-8M15 6l4 0',
  workout: 'M6 7v10M18 7v10M3 10v4M21 10v4M6 12h12',
  other: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 8v4l3 2',
  trophy: 'M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3',
  heart: 'M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z',
  clock: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 7v5l3 2',
  mountain: 'm3 20 6-10 4 6 2-3 6 7z',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a4 4 0 0 1 8 0v6a4 4 0 0 0 4 0V9',
  flag: 'M5 21V4M5 4h11l-2 4 2 4H5',
  segment: 'M4 18 9 9l4 5 3-4 4 8M4 18h16',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  trash: 'M4 7h16M10 11v6M14 11v6M5 7l1 13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16zM13.5 6.5l4 4',
  share: 'M12 15V3M7 8l5-5 5 5M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7',
  play: 'M7 4v16l13-8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  stop: 'M6 6h12v12H6z',
  x: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12l5 5 9-10',
  right: 'M9 6l6 6-6 6',
  left: 'M15 6l-6 6 6 6',
  layers: 'M12 3 2 8l10 5 10-5zM2 13l10 5 10-5',
  locate: 'M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0M12 2v3M12 19v3M2 12h3M19 12h3M12 12m-7 0a7 7 0 1 0 14 0a7 7 0 1 0-14 0',
  bluetooth: 'M7 7l10 10-5 4V3l5 4L7 17',
  volume: 'M4 9v6h4l5 4V5L8 9zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  target: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  flame: 'M12 21c-4 0-7-2.7-7-6.5 0-4 4-6 3.5-10.5 3 1.5 5 4 5 7 1-1 1.5-2 1.5-3.5 2 1.5 4 4 4 7.5 0 3.8-3 6-7 6z',
  zap: 'M13 2 4 14h7l-1 8 9-12h-7z',
  calendar: 'M4 6h16v15H4zM4 10h16M8 3v4M16 3v4',
  star: 'M12 3l2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z',
  undo: 'M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  cube: 'M12 3 3 7.5v9L12 21l9-4.5v-9zM3 7.5l9 4.5 9-4.5M12 12v9',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  swap: 'M7 4 3 8l4 4M3 8h14M17 20l4-4-4-4M21 16H7',
  loop: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  shoe: 'M3 16v-5l4-1 3 2h3l6 2a2 2 0 0 1 2 2v1H3zM3 19h18',
  info: 'M12 12m-9 0a9 9 0 1 0 18 0a9 9 0 1 0-18 0M12 11v5M12 8h.01',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
  gauge: 'M4 15a8 8 0 1 1 16 0M12 15l4-5',
  signal: 'M5 18v-3M9 18v-6M13 18V9M17 18V6',
  sparkle: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z',
  wifi: 'M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2 9a15 15 0 0 1 20 0',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
}

export function Icon({ name, size = 1.25, fill, stroke = 2, class: cls, style }: { name: string; size?: number; fill?: boolean; stroke?: number; class?: string; style?: JSX.CSSProperties }) {
  const d = P[name] ?? P.other
  return (
    <svg
      viewBox="0 0 24 24"
      width={`${size}rem`}
      height={`${size}rem`}
      fill={fill ? 'currentColor' : 'none'}
      stroke="currentColor"
      stroke-width={stroke}
      stroke-linecap="round"
      stroke-linejoin="round"
      class={cls}
      style={{ flex: 'none', ...(style || {}) }}
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

export function Logo({ size = 1.1 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={`${size}rem`} height={`${size}rem`} fill="none" stroke="currentColor" stroke-width={2.6} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M3 17l5-6 4 4 4-7 5 5" />
    </svg>
  )
}
