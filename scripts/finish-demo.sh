#!/usr/bin/env bash
# Finish a demo recording: trim it to the demo plus 3 s and embed its chapters (Task 13 fix rounds 1–2, T13-M10, T13-m4,
# T13R2-n7: screencapture's exit follows its file write, so the measured offset can be late; 3 s keeps the final hold).
# A still opening (screencapture's warm-up shows nothing moving for its first seconds) is cut back to HEAD_KEEP seconds
# before the first frame that changes, and the chapters move with it (Mac run 3, critique m2). The chapters are placed
# from the file's own length: screencapture writes a little less than it is asked for (279.03 s for 280; critique n5).
#
#   scripts/finish-demo.sh <video> <chapters.json> <output> [corner-tag]
#
#   video          the raw recording (macOS m3-demo.mov from screencapture -V, or the Linux x11grab m3-demo.mp4)
#   chapters.json  m3-demo.chapters.json from the same run: demoSeconds, offset (seconds from the chapters' zero to the
#                  recording's first frame, assuming a file of recordSeconds), recordSeconds (macOS) and chapters[].ms /
#                  .title
#   output         the finished file (same container as <video>)
#   corner-tag     optional text burned into the bottom-left corner, inside the drop overlay's 12 px inset (x 40,
#                  48 above the bottom, device px; re-encodes; the Linux recording uses it)
#
# The end is cut with -t, so stream copy cuts cleanly; without a tag it copies, and re-encodes (H.264 CRF 18, yuv420p)
# only if copying fails. A still head is cut first by re-encoding from it (frame-accurate). If the end cut fails both
# ways the untrimmed file is copied to <output> unchanged, and this says so on stderr and exits 3. Needs ffmpeg,
# ffprobe and python3.
set -euo pipefail

[[ $# -ge 3 && $# -le 4 ]] || { sed -n '2,21p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }
VIDEO=$1 JSON=$2 OUT=$3 TAG=${4:-}
for tool in ffmpeg ffprobe python3; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done
[[ -f $VIDEO ]] || { echo "no video: $VIDEO" >&2; exit 1; }
[[ -f $JSON ]] || { echo "no chapters: $JSON" >&2; exit 1; }

ROOT=$(cd "$(dirname "$0")/.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

RAW_SECONDS=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$VIDEO")

# The still head: freezedetect over the first 30 s. A freeze from the first frame (≤ 0.1 s) that ends gives the first
# changing frame; the cut keeps HEAD_KEEP seconds before it. None (or a file that never changes): no cut.
HEAD_KEEP=0.5
HEAD=$(ffmpeg -hide_banner -nostats -v info -t 30 -i "$VIDEO" -map 0:v:0 -vf "freezedetect=n=0.001:d=0.5" -f null - 2>&1 |
  python3 -I -c '
import re, sys
text = sys.stdin.read()
starts = [float(x) for x in re.findall(r"freeze_start: ([0-9.]+)", text)]
ends = [float(x) for x in re.findall(r"freeze_end: ([0-9.]+)", text)]
keep = float(sys.argv[1])
print(f"{max(0.0, ends[0] - keep):.3f}" if starts and starts[0] <= 0.1 and ends and ends[0] - keep > 0.05 else "0")
' "$HEAD_KEEP") || HEAD=0
SOURCE=$VIDEO
if [[ $HEAD != 0 ]]; then
  # Re-encoded from the cut (an input -ss with a re-encode is frame-accurate); the end cut below then works on it.
  if ffmpeg -v error -y -ss "$HEAD" -i "$VIDEO" -map 0 -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a copy -movflags +faststart "$WORK/head-cut.${VIDEO##*.}"; then
    SOURCE=$WORK/head-cut.${VIDEO##*.}
    echo "finish-demo: cut a still opening of $HEAD s (kept $HEAD_KEEP s before the first change)"
  else
    echo "finish-demo: cutting the still opening failed; it stays" >&2
    HEAD=0
  fi
fi

# ffmetadata chapters (in video time: ms / 1000 − offset − head) and the trimmed length (demoSeconds − offset + 3 − head).
LENGTH=$(python3 -I - "$JSON" "$RAW_SECONDS" "$WORK/chapters.txt" "$HEAD" <<'PY'
import json, sys
data = json.load(open(sys.argv[1], encoding='utf-8'))
raw = float(sys.argv[2])
head = float(sys.argv[4])
offset = float(data.get('offset') or 0)
demo = float(data.get('demoSeconds') or 0)
record = data.get('recordSeconds')
if record:
    # The offset assumed a file of recordSeconds that ended when screencapture exited; the file is `raw` long, so its
    # first frame came (record − raw) s later than that (critique mac3 n5: the marks landed 0.80–0.90 s late).
    print(f'finish-demo: raw {raw:.2f}s vs recordSeconds {record}s: {raw - float(record):+.2f}s (chapters placed from raw)', file=sys.stderr)
    offset += float(record) - raw
length = (min(raw, demo - offset + 3) if demo > 0 else raw) - head
starts = [max(0.0, c['ms'] / 1000 - offset - head) for c in data.get('chapters', [])]
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
echo "finish-demo: $(basename "$VIDEO") ${RAW_SECONDS}s → ${LENGTH}s (head cut ${HEAD}s), $(grep -c '^\[CHAPTER\]' "$WORK/chapters.txt") chapters"

encode() { # re-encode with the chapters (and the tag, if any)
  local vf=()
  if [[ -n $TAG ]]; then
    local font
    font=$(ls "$ROOT"/apps/desktop/node_modules/pretendard/dist/public/static/alternative/Pretendard-Medium.ttf 2>/dev/null | head -n 1)
    [[ -n $font ]] || { echo "Pretendard-Medium.ttf not found (pnpm install)" >&2; return 1; }
    printf '%s' "$TAG" > "$WORK/tag.txt"
    vf=(-vf "drawtext=fontfile=$font:textfile=$WORK/tag.txt:fontsize=h/80:fontcolor=white@0.85:box=1:boxcolor=black@0.45:boxborderw=10:x=40:y=h-th-48")
  fi
  ffmpeg -v error -y -i "$SOURCE" -i "$WORK/chapters.txt" -map 0 -map_metadata 1 -map_chapters 1 -t "$LENGTH" \
    "${vf[@]}" -c:v libx264 -preset medium -crf 18 -pix_fmt yuv420p -c:a copy -movflags +faststart "$OUT"
}

if [[ -n $TAG ]]; then
  encode && { echo "finish-demo: wrote $OUT (re-encoded with the tag)"; exit 0; }
else
  ffmpeg -v error -y -i "$SOURCE" -i "$WORK/chapters.txt" -map 0 -map_metadata 1 -map_chapters 1 -t "$LENGTH" -c copy "$OUT" &&
    { echo "finish-demo: wrote $OUT (stream copy)"; exit 0; }
  echo "finish-demo: stream copy failed, re-encoding" >&2
  encode && { echo "finish-demo: wrote $OUT (re-encoded)"; exit 0; }
fi
cp "$VIDEO" "$OUT"
echo "finish-demo: trimming failed — $OUT is the untrimmed recording, without chapters" >&2
exit 3
