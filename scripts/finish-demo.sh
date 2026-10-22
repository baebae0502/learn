#!/usr/bin/env bash
# Finish a demo recording: trim it to the demo plus 2 s and embed its chapters (Task 13 fix round 1, T13-M10, T13-m4).
#
#   scripts/finish-demo.sh <video> <chapters.json> <output> [corner-tag]
#
#   video          the raw recording (macOS m3-demo.mov from screencapture -V, or the Linux x11grab m3-demo.mp4)
#   chapters.json  m3-demo.chapters.json from the same run: demoSeconds, offset (seconds from the chapters' zero to the
#                  recording's first frame) and chapters[].ms / .title
#   output         the finished file (same container as <video>)
#   corner-tag     optional text burned into the bottom-left corner (re-encodes; the Linux recording uses it)
#
# The cut is the end only (-t), so stream copy cuts cleanly; without a tag it copies, and re-encodes (H.264 CRF 18,
# yuv420p) only if copying fails. If both fail the untrimmed file is copied to <output> unchanged, and this says so on
# stderr and exits 3. Needs ffmpeg, ffprobe and python3.
set -euo pipefail

[[ $# -ge 3 && $# -le 4 ]] || { sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
VIDEO=$1 JSON=$2 OUT=$3 TAG=${4:-}
for tool in ffmpeg ffprobe python3; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done
[[ -f $VIDEO ]] || { echo "no video: $VIDEO" >&2; exit 1; }
[[ -f $JSON ]] || { echo "no chapters: $JSON" >&2; exit 1; }

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

RAW_SECONDS=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")

# ffmetadata chapters (in video time: ms / 1000 − offset) and the trimmed length (demoSeconds − offset + 2).
LENGTH=$(python3 -I - "$JSON" "$RAW_SECONDS" "$WORK/chapters.txt" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
raw = float(sys.argv[2])
offset = float(data.get('offset') or 0)
demo = float(data.get('demoSeconds') or 0)
length = min(raw, demo - offset + 2) if demo > 0 else raw
starts = [max(0.0, c['ms'] / 1000 - offset) for c in data.get('chapters', [])]
def esc(s):
    return ''.join('\\' + ch if ch in '=;#\\\n' else ch for ch in s)
with open(sys.argv[3], 'w', encoding='utf-8') as f:
    f.write(';FFMETADATA1\n')
    for i, c in enumerate(data.get('chapters', [])):
        start = starts[i]
        end = starts[i + 1] if i + 1 < len(starts) else length
        if end <= start or start >= length:
            continue
        f.write(f"[CHAPTER]\nTIMEBASE=1/1000\nSTART={round(start * 1000)}\nEND={round(min(end, length) * 1000)}\ntitle={esc(c['title'])}\n")
print(f'{length:.3f}')
PY
)
echo "finish-demo: $(basename "$VIDEO") ${RAW_SECONDS}s → ${LENGTH}s, $(grep -c '^\[CHAPTER\]' "$WORK/chapters.txt") chapters"

encode() { # re-encode with the chapters (and the tag, if any)
  local vf=()
  if [[ -n $TAG ]]; then
    local font
    font=$(ls "$ROOT"/apps/desktop/node_modules/pretendard/dist/public/static/alternative/Pretendard-Medium.ttf 2>/dev/null | head -n 1)
    [[ -n $font ]] || { echo "Pretendard-Medium.ttf not found (pnpm install)" >&2; return 1; }
    printf '%s' "$TAG" > "$WORK/tag.txt"
    vf=(-vf "drawtext=fontfile=$font:textfile=$WORK/tag.txt:fontsize=h/80:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=10:x=18:y=h-th-28")
  fi
  ffmpeg -v error -y -i "$VIDEO" -i "$WORK/chapters.txt" -map 0 -map_metadata 1 -map_chapters 1 -t "$LENGTH" \
    "${vf[@]}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a copy -movflags +faststart "$OUT"
}

if [[ -n $TAG ]]; then
  encode && { echo "finish-demo: wrote $OUT (re-encoded with the tag)"; exit 0; }
else
  ffmpeg -v error -y -i "$VIDEO" -i "$WORK/chapters.txt" -map 0 -map_metadata 1 -map_chapters 1 -t "$LENGTH" -c copy "$OUT" &&
    { echo "finish-demo: wrote $OUT (stream copy)"; exit 0; }
  echo "finish-demo: stream copy failed, re-encoding" >&2
  encode && { echo "finish-demo: wrote $OUT (re-encoded)"; exit 0; }
fi
cp "$VIDEO" "$OUT"
echo "finish-demo: trimming failed — $OUT is the untrimmed recording, without chapters" >&2
exit 3
