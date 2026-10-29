#!/usr/bin/env bash
# Silent until the main-push CI and React Doctor workflows for one SHA finish.
# Prints one stdout line: "DONE: ..." or "FAILED: ...". Diagnostics go to the log file.
set -u
SHA=${1:-$(git rev-parse HEAD)}
LOG=${TMPDIR:-/tmp}/fc-ship-wait-${SHA}.log
: >"$LOG"

while :; do
    if ! runs=$(gh run list --commit "$SHA" --limit 20 --json databaseId,name,status,conclusion,event 2>>"$LOG"); then
        echo "gh run list failed" >>"$LOG"
        sleep 30
        continue
    fi
    result=$(RUNS="$runs" python3 - <<'PY' 2>>"$LOG"
import json, os, subprocess, sys
bad = {"failure", "cancelled", "timed_out", "startup_failure", "action_required"}
wanted = {"CI", "React Doctor"}
runs = [run for run in json.loads(os.environ["RUNS"]) if run.get("event") == "push" and run.get("name") in wanted]
latest = {}
for run in runs:
    name = run["name"]
    if name not in latest or run["databaseId"] > latest[name]["databaseId"]:
        latest[name] = run
if set(latest) != wanted:
    raise SystemExit(0)
failed = []
for name, run in latest.items():
    conclusion = run.get("conclusion") or ""
    if conclusion in bad:
        failed.append(f"{name}={conclusion}")
        continue
    if conclusion == "success":
        continue
    detail = subprocess.run(
        ["gh", "run", "view", str(run["databaseId"]), "--json", "jobs"],
        check=False,
        capture_output=True,
        text=True,
    )
    if detail.returncode != 0:
        print(detail.stderr, file=sys.stderr)
        continue
    for job in json.loads(detail.stdout).get("jobs") or []:
        if job.get("conclusion") in bad:
            failed.append(f"{name}/{job['name']}={job['conclusion']}")
if failed:
    print("FAILED: " + ", ".join(failed))
elif all(run.get("conclusion") == "success" for run in latest.values()):
    print("DONE: CI and React Doctor succeeded")
PY
)
    case "$result" in
        DONE:*|FAILED:*)
            printf '%s\n' "$result"
            [ "${result#FAILED:}" != "$result" ] && exit 1
            exit 0
            ;;
    esac
    sleep 30
done
