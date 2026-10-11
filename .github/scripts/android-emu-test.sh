#!/usr/bin/env bash
# Runs the autotest build on an Android emulator with a moving GPS position,
# turns the screen off for 90 s mid-run (a locked phone) and checks the saved
# track has no hole.
set -u
APK=android/app/build/outputs/apk/debug/app-debug.apk
PKG=dev.ahristov.redline
mkdir -p out
adb install -r "$APK"
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS ACTIVITY_RECOGNITION; do adb shell pm grant $PKG android.permission.$p || true; done
adb shell settings put global location_mode 3 || true
adb logcat -c
adb logcat -v time > out/logcat.txt 2>&1 &
# Move along a loop in Sofia at about 3 m/s, one fix per second.
node -e "
  const w=[[23.342,42.6865],[23.353,42.68],[23.36,42.6745],[23.35,42.6705],[23.342,42.6865]]
  const R=6371008.8,r=Math.PI/180,out=[]
  const h=(a,b)=>{const dl=(b[1]-a[1])*r,dn=(b[0]-a[0])*r,x=Math.sin(dl/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x))}
  for(let i=1;i<w.length;i++){const n=Math.round(h(w[i-1],w[i])/3);for(let k=0;k<n;k++)out.push([w[i-1][0]+(w[i][0]-w[i-1][0])*k/n,w[i-1][1]+(w[i][1]-w[i-1][1])*k/n])}
  require('fs').writeFileSync('out/route.txt',out.map(p=>p[0].toFixed(6)+' '+p[1].toFixed(6)).join('\n'))
"
# adb must not read the loop's stdin, or it swallows the route after a few lines.
( while read -r lon lat; do adb emu geo fix "$lon" "$lat" < /dev/null > /dev/null; sleep 1; done < out/route.txt ) &
FEED=$!
sleep 5
adb shell am start -n $PKG/.MainActivity
sleep 50
adb exec-out screencap -p > out/1-recording.png
echo "== screen off"
adb shell input keyevent KEYCODE_SLEEP
sleep 90
echo "== screen on"
adb shell input keyevent KEYCODE_WAKEUP
adb shell wm dismiss-keyguard || true
sleep 25
adb exec-out screencap -p > out/2-back.png
sleep 140
adb exec-out screencap -p > out/3-result.png
kill $FEED || true
grep "AUTOTEST" out/logcat.txt | sed 's/.*\[AUTOTEST\]/[AUTOTEST]/' | tail -60
grep -q '\[AUTOTEST\] result {"ok":true' out/logcat.txt
