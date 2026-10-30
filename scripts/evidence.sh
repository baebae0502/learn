#!/usr/bin/env bash
# Run the macOS evidence workflow from this (headless) machine and download what it produced.
#
#   scripts/evidence.sh <branch> <suite> <label> [runner] [packaged]
#
#   branch    branch (or tag) whose workflow/tests to run, e.g. m0-evidence
#   suite     baseline | e2e | evidence | perf | demo | mockups | library | organize | all
#   label     evidence label, [A-Za-z0-9._-]{1,64}
#   runner    macos-15 (default) | macos-26
#   packaged  false (default) | true   (also build and exercise an unsigned electron-builder --dir app)
#
# Output: evidence/<label>/<run_id>/{evidence,demo}/ plus run.json (timings, download speed); a demo recording is
# also trimmed and given its chapters (demo/**/m5-demo.final.mov, scripts/finish-demo.sh).
# EVIDENCE_RUN_ID=<id> skips the dispatch and attaches to (or re-downloads) an existing run.
# Exit status: the run's (gh run watch --exit-status); 3 if the run passed but its evidence could not be downloaded.
# Every macOS run costs billed minutes (x10 on a private repo): log it in docs/mac-verification.md.
set -euo pipefail

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

[[ $# -ge 3 && $# -le 5 ]] || usage
BRANCH=$1 SUITE=$2 LABEL=$3 RUNNER=${4:-macos-15} PACKAGED=${5:-false}

[[ $BRANCH =~ ^[A-Za-z0-9._/-]{1,200}$ ]] || { echo "invalid branch: $BRANCH" >&2; exit 2; }
case $SUITE in baseline|e2e|evidence|perf|demo|mockups|library|organize|all) ;; *) echo "invalid suite: $SUITE" >&2; usage ;; esac
[[ $LABEL =~ ^[A-Za-z0-9._-]{1,64}$ ]] || { echo "invalid label: $LABEL" >&2; exit 2; }
case $RUNNER in macos-15|macos-26) ;; *) echo "invalid runner: $RUNNER" >&2; usage ;; esac
case $PACKAGED in true|false) ;; *) echo "invalid packaged (true|false): $PACKAGED" >&2; usage ;; esac

for tool in gh git python3; do command -v "$tool" >/dev/null || { echo "$tool is required" >&2; exit 1; }; done

ROOT=$(git rev-parse --show-toplevel)
cd "$ROOT"
REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
WORKFLOW=macos-evidence.yml

now() { date +%s; }
iso() { date -u +%Y-%m-%dT%H:%M:%SZ; }

t_dispatch=$(now)
RUN_ID=${EVIDENCE_RUN_ID:-}
if [[ -n $RUN_ID ]]; then
  [[ $RUN_ID =~ ^[0-9]+$ ]] || { echo "invalid EVIDENCE_RUN_ID: $RUN_ID" >&2; exit 2; }
  echo "[$(iso)] attaching to existing run $RUN_ID (no dispatch)"
else
  # Remember existing runs so the new one can be told apart without trusting clocks.
  known=$(gh run list -R "$REPO" --workflow "$WORKFLOW" --limit 50 --json databaseId -q '.[].databaseId' | sort -u)
  echo "[$(iso)] dispatch $WORKFLOW on $BRANCH: suite=$SUITE label=$LABEL runner=$RUNNER packaged=$PACKAGED"
  gh workflow run "$WORKFLOW" -R "$REPO" --ref "$BRANCH" \
    -f suite="$SUITE" -f label="$LABEL" -f runner="$RUNNER" -f packaged="$PACKAGED"
  for _ in $(seq 1 30); do
    sleep 4
    while read -r id; do
      [[ -n $id ]] || continue
      if ! grep -qx "$id" <<<"$known"; then RUN_ID=$id; break; fi
    done < <(gh run list -R "$REPO" --workflow "$WORKFLOW" --branch "$BRANCH" --event workflow_dispatch \
               --limit 10 --json databaseId -q '.[].databaseId')
    [[ -n $RUN_ID ]] && break
  done
  [[ -n $RUN_ID ]] || { echo "could not find the dispatched run" >&2; exit 1; }
fi
URL="https://github.com/$REPO/actions/runs/$RUN_ID"
echo "[$(iso)] run $RUN_ID  $URL"

set +e
gh run watch "$RUN_ID" -R "$REPO" --exit-status --interval 30 >/dev/null
STATUS=$?
set -e
t_done=$(now)
CONCLUSION=$(gh run view "$RUN_ID" -R "$REPO" --json conclusion -q .conclusion)
echo "[$(iso)] run $RUN_ID finished: $CONCLUSION (wall $(( t_done - t_dispatch ))s from dispatch)"

if [[ $STATUS -ne 0 ]]; then
  echo "---- failed step logs (tail) ----"
  for _ in 1 2 3; do # logs can take a few seconds to become available after completion
    failed_log=$(gh run view "$RUN_ID" -R "$REPO" --log-failed 2>/dev/null | tail -n 150 || true)
    [[ -n $failed_log ]] && break
    sleep 10
  done
  printf '%s\n' "${failed_log:-(no failed-step log available)}"
  echo "---------------------------------"
fi

DEST="evidence/$LABEL/$RUN_ID"
mkdir -p "$DEST"
gh run view "$RUN_ID" -R "$REPO" --json jobs,createdAt,updatedAt,conclusion,headSha,headBranch > "$DEST/run-view.json"
gh api "repos/$REPO/actions/runs/$RUN_ID/artifacts" > "$DEST/artifacts.json"

download() { # name subdir -> prints "bytes seconds"; returns 2 if the run has no such artifact, 1 if the download failed
  local name=$1 sub=$2 size t0 t1
  size=$(python3 -I -c 'import json,sys; a=[x for x in json.load(open(sys.argv[1]))["artifacts"] if x["name"]==sys.argv[2]]; print(a[0]["size_in_bytes"] if a else "")' "$DEST/artifacts.json" "$name")
  [[ -n $size ]] || { echo "- -"; return 2; }
  rm -rf "${DEST:?}/$sub" # re-download from scratch (gh refuses to overwrite)
  t0=$(date +%s.%N)
  if ! gh run download "$RUN_ID" -R "$REPO" -n "$name" -D "$DEST/$sub" >/dev/null; then echo "- -"; return 1; fi
  t1=$(date +%s.%N)
  echo "$size $(python3 -I -c 'import sys; print(f"{float(sys.argv[2])-float(sys.argv[1]):.2f}")' "$t0" "$t1")"
}

DOWNLOAD_ERRORS=()
rc=0; got=$(download "evidence-$LABEL-$RUN_ID" evidence) || rc=$?
read -r EV_BYTES EV_SECS <<<"$got"
case $rc in 0) ;; 2) DOWNLOAD_ERRORS+=("evidence-$LABEL-$RUN_ID: no such artifact") ;; *) DOWNLOAD_ERRORS+=("evidence-$LABEL-$RUN_ID: download failed") ;; esac
rc=0; got=$(download "demo-$LABEL-$RUN_ID" demo) || rc=$?
read -r DEMO_BYTES DEMO_SECS <<<"$got"
[[ $rc -ne 1 ]] || DOWNLOAD_ERRORS+=("demo-$LABEL-$RUN_ID: download failed") # no recordings is fine

# Renderer screencast frames (CDP fallback) → mp4, when ffmpeg is available here.
if command -v ffmpeg >/dev/null && [[ -d $DEST/demo ]]; then
  while IFS= read -r -d '' dir; do
    fps=$(python3 -I -c 'import json,sys; d=json.load(open(sys.argv[1])); n=len(d["frames"]); s=d["seconds"]; print(f"{(n-1)/s:.3f}" if s>0 and n>1 else "10")' "$dir/frames.json" 2>/dev/null || echo 10)
    ffmpeg -v error -y -framerate "$fps" -i "$dir/%05d.jpg" -vf "scale=trunc(iw/2)*2:trunc(ih/2)*2" \
      -c:v libx264 -pix_fmt yuv420p "${dir%.frames}.mp4" && echo "assembled ${dir%.frames}.mp4 (${fps} fps)"
  done < <(find "$DEST/demo" -type d -name '*.frames' -print0)
fi

# Demo recordings (screencapture -V runs longer than the demo): trimmed to the demo plus 2 s with the chapters embedded,
# beside the raw file as <name>.final.mov (scripts/finish-demo.sh). A failed trim keeps the raw recording and says so;
# it never changes this script's exit status.
if command -v ffmpeg >/dev/null && [[ -d $DEST/demo ]]; then
  while IFS= read -r -d '' mov; do
    json=$(find "$DEST/evidence" -name "$(basename "${mov%.*}").chapters.json" -print -quit 2>/dev/null || true)
    if [[ -z $json ]]; then
      echo "finish-demo: no chapters.json for $mov: left untrimmed" >&2
      continue
    fi
    "$ROOT/scripts/finish-demo.sh" "$mov" "$json" "${mov%.*}.final.${mov##*.}" || echo "finish-demo: $mov kept untrimmed (see above)" >&2
  done < <(find "$DEST/demo" -name 'm[0-9]*-demo.mov' -print0)
fi

python3 -I - "$DEST" "$RUN_ID" "$URL" "$BRANCH" "$SUITE" "$LABEL" "$RUNNER" "$PACKAGED" "$CONCLUSION" \
  "$t_dispatch" "$t_done" "$EV_BYTES" "$EV_SECS" "$DEMO_BYTES" "$DEMO_SECS" <<'PY'
import json, math, os, sys
from datetime import datetime
(dest, run_id, url, branch, suite, label, runner, packaged, conclusion,
 t_dispatch, t_done, ev_b, ev_s, demo_b, demo_s) = sys.argv[1:]
view = json.load(open(os.path.join(dest, "run-view.json")))
def ts(s): return datetime.fromisoformat(s.replace("Z", "+00:00"))
jobs = []
for j in view.get("jobs", []):
    if j.get("startedAt") and j.get("completedAt"):
        secs = (ts(j["completedAt"]) - ts(j["startedAt"])).total_seconds()
        jobs.append({"name": j["name"], "conclusion": j.get("conclusion"), "seconds": round(secs),
                     "billedMinutes": max(1, math.ceil(secs / 60))})
def speed(b, s):
    try:
        b, s = int(b), float(s)
        return {"bytes": b, "seconds": s, "bytesPerSec": round(b / s) if s > 0 else None}
    except ValueError:
        return None
pngs = []
for root, _, files in os.walk(os.path.join(dest, "evidence")):
    pngs += [os.path.relpath(os.path.join(root, f), dest) for f in files if f.endswith(".png")]
def find(name):
    for root, _, files in os.walk(os.path.join(dest, "evidence")):
        if name in files: return os.path.relpath(os.path.join(root, name), dest)
    return None
def stats(name):
    rel = find(name)
    if not rel: return None
    try:
        st = json.load(open(os.path.join(dest, rel))).get("stats", {})
        return {k: st.get(k) for k in ("expected", "unexpected", "skipped", "flaky")}
    except (OSError, ValueError):
        return None
summary = {
    "runId": int(run_id), "url": url, "branch": branch, "suite": suite, "label": label, "runner": runner,
    "packaged": packaged == "true", "conclusion": conclusion, "headSha": view.get("headSha"),
    "wallSecondsFromDispatch": int(t_done) - int(t_dispatch), "jobs": jobs,
    "macMinutes": sum(j["billedMinutes"] for j in jobs if j["name"] == "mac"),
    "download": {"evidence": speed(ev_b, ev_s), "demo": speed(demo_b, demo_s)},
    "pngCount": len(pngs), "fullScreenPngs": sorted(p for p in pngs if p.endswith(".screen.png")),
    "envJson": find("env.json"), "baselineJson": find("baseline.json"), "spikesJson": find("spikes.json"),
    "evidenceTests": stats("report.json"), "functionalE2E": stats("e2e-report.json"),
}
json.dump(summary, open(os.path.join(dest, "run.json"), "w"), indent=2)
print(json.dumps({k: summary[k] for k in ("runId", "conclusion", "jobs", "macMinutes", "download", "pngCount",
                                         "envJson", "baselineJson", "spikesJson", "evidenceTests", "functionalE2E")}, indent=2))
print(f"evidence downloaded to {dest}")
PY

if [[ ${#DOWNLOAD_ERRORS[@]} -gt 0 ]]; then
  printf 'download error: %s\n' "${DOWNLOAD_ERRORS[@]}" >&2
  [[ $STATUS -ne 0 ]] || STATUS=3 # a green run without its evidence is not a success
fi
exit "$STATUS"
