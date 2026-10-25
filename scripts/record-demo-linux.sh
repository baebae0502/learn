#!/usr/bin/env bash
# Record the M4 demo on Linux at @2x, as a supplement to the macOS recording (a script, not a CI step):
# Xvfb, the @demo test at full pace (LEARN_DEMO_PACE=1) with --force-device-scale-factor=2, and ffmpeg x11grab of
# exactly the window, started and stopped by the test (capture.ts startX11Recording); then scripts/finish-demo.sh embeds
# the chapters and burns in the corner tag "Linux 보조 녹화 · 창 테두리 없음 (창 관리자 없음)".
#
#   scripts/record-demo-linux.sh [--force] [width height]    default 2880 1800: the 1440 × 900 window at @2x
#
# Playwright empties evidence-results/ (its outputDir) when it starts, as every evidence run does: this refuses to start
# while evidence-results/ holds anything, unless --force.
#
# Output (gitignored): evidence/demo-linux/<UTC timestamp>/
#   m4-demo-linux.mp4          the video (H.264 yuv420p CRF 18, 30 fps), chapters embedded, the corner tag burned in
#   m4-demo.chapters.raw.txt/.json the chapter list on the raw recording's timeline, input, screen and window bounds, notes
#   m4-demo-linux.chapters.txt/.json the chapters on the finished video's own timeline (finish-demo.sh)
#   frames/ch-NN.png           one frame per chapter: 3 s in, or halfway through a shorter chapter
#   run.log, build.log         the Playwright run and the build
# Needs Xvfb, xdpyinfo, ffmpeg (with x11grab and libx264), ffprobe, node, pnpm and python3. Builds the app first.
set -euo pipefail

FORCE=false
if [[ ${1:-} == --force ]]; then FORCE=true; shift; fi
W=${1:-2880}
H=${2:-1800}
SCALE=2
[[ $W =~ ^[0-9]+$ && $H =~ ^[0-9]+$ && $((W % (2 * SCALE))) -eq 0 && $((H % (2 * SCALE))) -eq 0 ]] || { echo "usage: $0 [--force] [width height] (multiples of $((2 * SCALE)))" >&2; exit 2; }
for tool in Xvfb xdpyinfo ffmpeg ffprobe node pnpm git python3; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done
ffmpeg -hide_banner -devices 2>/dev/null | grep -q x11grab || { echo "ffmpeg has no x11grab device" >&2; exit 1; }

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
if [[ $FORCE != true && -d evidence-results ]] && [[ -n $(ls -A evidence-results) ]]; then
  echo "evidence-results/ is not empty, and Playwright would empty it: move it away, or pass --force" >&2
  exit 2
fi
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
# -noreset: Xvfb otherwise resets when its last client leaves, putting its pointer back at the screen's centre between
# the parking below and the app's start; a new window then drew its first disc there (T13R4-n2).
Xvfb "$DISP" -screen 0 "${SW}x${SH}x24" -nolisten tcp -noreset >"$OUT/xvfb.log" 2>&1 &
XVFB=$!
# Also the test's ffmpeg grabbing this display, should the run end abnormally (review minor 3).
cleanup() {
  pkill -f -- "x11grab.*-i ${DISP}[+]" 2>/dev/null || true
  kill "$XVFB" 2>/dev/null || true
}
trap cleanup EXIT
for _ in $(seq 1 100); do xdpyinfo -display "$DISP" >/dev/null 2>&1 && break; sleep 0.1; done
xdpyinfo -display "$DISP" >/dev/null 2>&1 || { echo "Xvfb did not start on $DISP" >&2; cat "$OUT/xvfb.log" >&2; exit 1; }
# The X server's own pointer (not drawn: x11grab -draw_mouse 0) starts in the middle of the screen, over the window:
# when a window opens, closes or moves, X sends the window under it a real pointer move, and the overlay's cursor
# would jump there. Parked in the screen's corner, outside every window (they start at 1 DIP), it sends nothing.
python3 -I - "$DISP" <<'PY' || echo "could not park the X pointer: the drawn cursor may jump when windows change" >&2
import ctypes, sys
x = ctypes.CDLL('libX11.so.6')
x.XOpenDisplay.restype = ctypes.c_void_p
x.XOpenDisplay.argtypes = [ctypes.c_char_p]
x.XDefaultRootWindow.restype = ctypes.c_ulong
x.XDefaultRootWindow.argtypes = [ctypes.c_void_p]
x.XWarpPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong, ctypes.c_ulong] + [ctypes.c_int] * 2 + [ctypes.c_uint] * 2 + [ctypes.c_int] * 2
x.XSync.argtypes = [ctypes.c_void_p, ctypes.c_int]
x.XQueryPointer.argtypes = [ctypes.c_void_p, ctypes.c_ulong] + [ctypes.c_void_p] * 7
x.XCloseDisplay.argtypes = [ctypes.c_void_p]
d = x.XOpenDisplay(sys.argv[1].encode())
if not d:
    sys.exit(1)
root = x.XDefaultRootWindow(d)
x.XWarpPointer(d, 0, root, 0, 0, 0, 0, 0, 0)
x.XSync(d, 0)
v = [ctypes.c_ulong(), ctypes.c_ulong()] + [ctypes.c_int() for _ in range(4)] + [ctypes.c_uint()]
x.XQueryPointer(d, root, *[ctypes.byref(a) for a in v])
x.XCloseDisplay(d)
print(f'X pointer parked at ({v[2].value}, {v[3].value})')
sys.exit(0 if (v[2].value, v[3].value) == (0, 0) else 1)
PY
echo "Xvfb $DISP ${SW}x${SH}; window ${W}x${H} at @${SCALE}; output $OUT"

[[ -f fixtures/generated/sample.pdf ]] || pnpm fixtures
pnpm build >"$OUT/build.log" 2>&1 || { echo "build failed (see $OUT/build.log)" >&2; exit 1; }

set +e
DISPLAY=$DISP EVIDENCE_LABEL=$LABEL LEARN_DEMO_PACE=1 LEARN_DEMO_SCALE=$SCALE LEARN_DEMO_GRAB="${W}x${H}+${SCALE},${SCALE}" \
  pnpm exec playwright test -c playwright.evidence.config.ts --grep "@demo" --reporter=list 2>&1 | tee "$OUT/run.log"
STATUS=${PIPESTATUS[0]}
set -e

SRC="evidence-results/$LABEL"
for f in m4-demo.chapters.raw.txt m4-demo.chapters.json; do [[ -f $SRC/$f ]] && cp "$SRC/$f" "$OUT/"; done
if [[ ! -s $SRC/m4-demo.mp4 ]]; then
  echo "no recording in $SRC (test exit $STATUS)" >&2
  exit 1
fi
VIDEO="$OUT/m4-demo-linux.mp4"
scripts/finish-demo.sh "$SRC/m4-demo.mp4" "$OUT/m4-demo.chapters.json" "$VIDEO" "Linux 보조 녹화 · 창 테두리 없음 (창 관리자 없음)"
rm -f "$SRC/m4-demo.mp4"

ffprobe -v error -select_streams v:0 -show_entries stream=width,height,pix_fmt,r_frame_rate,codec_name -show_entries format=duration -of default=nw=1 "$VIDEO" | tee "$OUT/ffprobe.txt"
ffprobe -v error -show_chapters -of csv=p=0 "$VIDEO" | wc -l | xargs -I{} echo "embedded chapters: {}" | tee -a "$OUT/ffprobe.txt"

# One frame per chapter: 3 s in, or halfway to the next chapter when it is shorter (n3).
DURATION=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")
SELECT=$(python3 -I - "${VIDEO%.*}.chapters.json" "$DURATION" <<'PY'
import json, sys
d = json.load(open(sys.argv[1], encoding='utf-8'))
end = float(sys.argv[2])
starts = [c['start'] for c in d['chapters']]  # on the finished video's timeline
picks = [min(s + 3, (s + (starts[i + 1] if i + 1 < len(starts) else end)) / 2) for i, s in enumerate(starts)]
print('+'.join(f'gte(t,{t:.4f})*lt(t,{t + 1 / 30:.4f})' for t in picks))  # [t, t + 1 frame): exactly one frame each
PY
)
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
