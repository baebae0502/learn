#!/usr/bin/env bash
# Record the M3 demo on Linux at @2x, as a supplement to the macOS recording (a script, not a CI step):
# Xvfb, the @demo test at full pace (LEARN_DEMO_PACE=1) with --force-device-scale-factor=2, and ffmpeg x11grab of
# exactly the window to H.264 (yuv420p, CRF 18, 30 fps), started and stopped by the test (capture.ts startX11Recording).
#
#   scripts/record-demo-linux.sh [width height]    default 2880 1800: the 1440 × 900 window at @2x
#
# Output (gitignored): evidence/demo-linux/<UTC timestamp>/
#   m3-demo-linux.mp4          the recording; label it "Linux, Pretendard, no native chrome"
#   m3-demo.chapters.txt/.json the chapter list (m:ss from the start of the video), input, screen and window bounds
#   frames/ch-NN.png           one frame per chapter, 3 s in (ffmpeg select), to check the video at a glance
#   run.log                    the Playwright run
# Needs Xvfb, xdpyinfo, ffmpeg (with x11grab and libx264), ffprobe, node and pnpm. Builds the app first.
set -euo pipefail

W=${1:-2880}
H=${2:-1800}
SCALE=2
[[ $W =~ ^[0-9]+$ && $H =~ ^[0-9]+$ && $((W % (2 * SCALE))) -eq 0 && $((H % (2 * SCALE))) -eq 0 ]] || { echo "usage: $0 [width height] (multiples of $((2 * SCALE)))" >&2; exit 2; }
for tool in Xvfb xdpyinfo ffmpeg ffprobe node pnpm git; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done
ffmpeg -hide_banner -devices 2>/dev/null | grep -q x11grab || { echo "ffmpeg has no x11grab device" >&2; exit 1; }

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="evidence/demo-linux/$TS"
LABEL="demo-linux-$TS"
mkdir -p "$OUT/frames"

# The X screen is one device-independent pixel larger than the window on every side: Chromium shrinks a frameless
# window that is exactly the screen's size by 1 px on Linux (Task 8), so the 1440 × 900 window opens centred at (1, 1)
# and ffmpeg grabs exactly it — no X root around it, no 2 px strip of nothing.
SW=$((W + 2 * SCALE))
SH=$((H + 2 * SCALE))
DISP=
for n in $(seq 99 160); do
  if [[ ! -e /tmp/.X11-unix/X$n && ! -e /tmp/.X$n-lock ]]; then DISP=:$n; break; fi
done
[[ -n $DISP ]] || { echo "no free X display number" >&2; exit 1; }
Xvfb "$DISP" -screen 0 "${SW}x${SH}x24" -nolisten tcp >"$OUT/xvfb.log" 2>&1 &
XVFB=$!
trap 'kill "$XVFB" 2>/dev/null || true' EXIT
for _ in $(seq 1 100); do xdpyinfo -display "$DISP" >/dev/null 2>&1 && break; sleep 0.1; done
xdpyinfo -display "$DISP" >/dev/null 2>&1 || { echo "Xvfb did not start on $DISP" >&2; cat "$OUT/xvfb.log" >&2; exit 1; }
echo "Xvfb $DISP ${SW}x${SH}; window ${W}x${H} at @${SCALE}; output $OUT"

[[ -f fixtures/generated/sample.pdf ]] || pnpm fixtures
pnpm build >"$OUT/build.log" 2>&1 || { echo "build failed (see $OUT/build.log)" >&2; exit 1; }

set +e
DISPLAY=$DISP EVIDENCE_LABEL=$LABEL LEARN_DEMO_PACE=1 LEARN_DEMO_SCALE=$SCALE LEARN_DEMO_GRAB="${W}x${H}+${SCALE},${SCALE}" \
  pnpm exec playwright test -c playwright.evidence.config.ts --grep "@demo" --reporter=list 2>&1 | tee "$OUT/run.log"
STATUS=${PIPESTATUS[0]}
set -e

SRC="evidence-results/$LABEL"
for f in m3-demo.chapters.txt m3-demo.chapters.json; do [[ -f $SRC/$f ]] && cp "$SRC/$f" "$OUT/"; done
if [[ ! -s $SRC/m3-demo.mp4 ]]; then
  echo "no recording in $SRC (test exit $STATUS)" >&2
  exit 1
fi
mv "$SRC/m3-demo.mp4" "$OUT/m3-demo-linux.mp4"
VIDEO="$OUT/m3-demo-linux.mp4"

ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt,r_frame_rate,codec_name -show_entries format=duration -of default=nw=1 "$VIDEO" | tee "$OUT/ffprobe.txt"

# One frame per chapter, 3 s after it starts (the state has settled by then).
SELECT=$(node -e '
  const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).chapters;
  console.log(c.map((x) => `between(t,${(x.ms / 1000 + 3).toFixed(3)},${(x.ms / 1000 + 3 + 1 / 30).toFixed(3)})`).join("+"));
' "$OUT/m3-demo.chapters.json")
ffmpeg -v error -y -i "$VIDEO" -vf "select='$SELECT'" -fps_mode vfr -start_number 1 "$OUT/frames/ch-%02d.png"

# The window fills the frame: the outermost 2 px on each side are the app's, not the black X root.
EDGES=$(for crop in "iw:2:0:0" "iw:2:0:ih-2" "2:ih:0:0" "2:ih:iw-2:0"; do
  ffmpeg -v error -i "$OUT/frames/ch-01.png" -vf "crop=$crop,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-" -f null - | sed -n 's/^lavfi.signalstats.YAVG=//p'
done | tr '\n' ' ')
echo "edge luma (top bottom left right) of ch-01: $EDGES"
for y in $EDGES; do
  awk -v y="$y" 'BEGIN { exit !(y < 30) }' && { echo "an edge of the frame is black: the window does not fill it" >&2; exit 1; }
done

echo "recorded $VIDEO ($(du -h "$VIDEO" | cut -f1)), $(ls "$OUT/frames" | wc -l) chapter frames, test exit $STATUS"
exit "$STATUS"
