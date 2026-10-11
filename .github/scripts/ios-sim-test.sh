#!/usr/bin/env bash
# Runs the autotest build in the iOS simulator with a moving simulated location,
# sends the app to the background for 90 s mid-run (what a locked phone does)
# and checks the saved track has no hole. Expects $UDID and a built App.app.
set -u
APP=build/sim/Build/Products/Debug-iphonesimulator/App.app
mkdir -p out
xcrun simctl boot "$UDID" || true
xcrun simctl bootstatus "$UDID" -b
xcrun simctl install "$UDID" "$APP"
xcrun simctl privacy "$UDID" grant location-always dev.ahristov.redline
xcrun simctl privacy "$UDID" grant motion dev.ahristov.redline || true
# A loop through Borisova Gradina park in Sofia at running speed.
xcrun simctl location "$UDID" start --speed=3 --interval=1 \
  42.6865,23.342 42.6800,23.353 42.6745,23.360 42.6705,23.350 42.6865,23.342
# Simulator boots on CI can report ready before SpringBoard is; give it time and
# retry the launch until the app's WebView has actually loaded.
sleep 20
for attempt in 1 2 3; do
  xcrun simctl launch --console-pty --terminate-running-process "$UDID" dev.ahristov.redline > out/console.log 2>&1 &
  for i in $(seq 1 30); do grep -q "WebView loaded" out/console.log && break; sleep 2; done
  grep -q "WebView loaded" out/console.log && break
  echo "== launch attempt $attempt did not load, retrying"; cat out/console.log | head -5
  sleep 10
done
if [ "${VITE_AUTOTEST_QUICK:-0}" = "1" ]; then
  sleep 45
  xcrun simctl io "$UDID" screenshot out/1-record.png
  # Same probes in the simulator's own Safari, to tell app issues from simulator issues.
  # Open twice: the first open can be covered by Safari's first-run screen.
  xcrun simctl openurl "$UDID" "https://redline-two-mu.vercel.app/probe.html?t=1" || true
  sleep 15
  xcrun simctl openurl "$UDID" "https://redline-two-mu.vercel.app/probe.html?t=2" || true
  sleep 25
  xcrun simctl io "$UDID" screenshot out/2-safari-probe.png
  xcrun simctl openurl "$UDID" "https://redline-two-mu.vercel.app/#/route/new" || true
  sleep 35
  xcrun simctl io "$UDID" screenshot out/3-safari-map.png
  # The app itself, but loading the probe over https instead of capacitor://
  CAP_SERVER_URL="https://redline-two-mu.vercel.app/probe.html" npx cap sync ios > /dev/null
  xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Debug -destination "id=$UDID" -derivedDataPath build/sim CODE_SIGNING_ALLOWED=NO build -quiet
  xcrun simctl terminate "$UDID" dev.ahristov.redline || true
  xcrun simctl install "$UDID" "$APP"
  xcrun simctl launch --console-pty "$UDID" dev.ahristov.redline > out/console-remote.log 2>&1 &
  sleep 45
  xcrun simctl io "$UDID" screenshot out/4-app-https-probe.png
  echo "== app over https:"; grep "PROBE\|WebView" out/console-remote.log | head -5
  grep "\[AUTOTEST\]" out/console.log | tail -20
  grep -q '\[AUTOTEST\] result {"ok":true' out/console.log
  exit $?
fi
sleep 50
xcrun simctl io "$UDID" screenshot out/1-recording.png
echo "== sending Redline to the background"
xcrun simctl launch "$UDID" com.apple.Preferences
sleep 90
xcrun simctl io "$UDID" screenshot out/2-other-app.png
echo "== bringing Redline back"
xcrun simctl launch "$UDID" dev.ahristov.redline
sleep 25
xcrun simctl io "$UDID" screenshot out/3-back.png
sleep 140
xcrun simctl io "$UDID" screenshot out/4-result.png
xcrun simctl location "$UDID" clear || true
echo "web layer restarts: $(grep -c 'WebView process terminated' out/console.log)"
echo "map errors: $(grep -c 'map-error\|map-sync\|vertexBuffer' out/console.log)"
grep "\[AUTOTEST\]" out/console.log | grep -v tick | tail -40
grep -q '\[AUTOTEST\] result {"ok":true' out/console.log
