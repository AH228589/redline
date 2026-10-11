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
xcrun simctl launch --console-pty --terminate-running-process "$UDID" dev.ahristov.redline > out/console.log 2>&1 &
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
