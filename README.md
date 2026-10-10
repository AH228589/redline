# Redline

A personal training app for runs, rides and hikes. Every feature is unlocked, there is no account, and all data lives in your browser on your device.

## Run it

```bash
npm install
npm run dev
```

Open http://localhost:5198. GPS recording needs HTTPS on a phone, so deploy it (below) to record outdoors.

## Deploy

Any static host works. With Vercel: `npx.cmd vercel --prod --yes` from this folder (log in first). Then open the site on your phone and use "Add to Home Screen" to install it like an app.

## Features

- **Record**: GPS tracking with live pace, voice splits, auto-pause, screen kept awake, crash recovery, heart rate straps over Bluetooth (Chrome), live segments with a ghost of your record, follow a saved route with off-route alerts, live location sharing by link.
- **Import**: GPX, TCX, FIT (also .gz), or a whole Strava export zip (names, types and descriptions come from activities.csv). GPX files without timestamps become routes.
- **Activity analysis**: map colored by pace, heart rate, elevation or grade, 3D terrain, synced charts with drag-to-select, splits, grade adjusted pace, best efforts with medals, heart rate, pace and power zones, power curve, detected and categorized climbs, matched activities on the same route, crop, terrain elevation correction, GPX export.
- **Segments**: make them from any selection or climb; all past activities are matched, with leaderboards and progress over time.
- **Routes**: tap to plan with routing that snaps to roads and trails (BRouter), loop generator for a target distance, elevation profile, personal time estimate, GPX export, offline map download.
- **Training**: fitness, fatigue and form, training load from power, heart rate, pace or perceived effort, weekly and monthly progress, year over year, training log calendar, records, race predictions, estimated threshold pace and FTP, goals, gear mileage.
- **Maps**: personal heatmap of everything you have done.

## Data

Stored in IndexedDB in the browser you use. Export a backup under You and restore it on another device. Clearing site data deletes everything.

## Services used (all free, no keys)

OpenFreeMap and OpenTopoMap tiles, AWS terrain tiles, BRouter routing, Open-Meteo elevation, PeerJS public broker for live sharing.
