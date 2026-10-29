---
name: fc-ship
description: >-
  Use when shipping First Crack from main, or when the user says fc:ship,
  /fc:ship, /fc-ship, "릴리스", "pnpm release", or "CI 성공하면 릴리스".
  First Crack repo only.
---

# fc:ship

Ship the desktop app from `main`. Green main-push CI, then `pnpm release`. The release script owns the version bump, commit, tag, and atomic push. Do not reimplement it.

Default bump is `patch`. Use `minor` or `major` only when the user names that bump. An explicit `major.minor.patch` is `pnpm release <version>`.

## Stop

- Not this repo, or not `main`.
- Tracked changes are uncommitted (`git status --porcelain` lines other than `??`). Say so. Do not commit them as part of ship.
- `HEAD` is behind `origin/main`. Merge `origin/main` first, then ship that result. No force-push.
- A required workflow is red. Fix, push, wait for the new SHA. Do not tag the red SHA.
- Do not pass `--force`. Do not set `SKIP_VERIFY`.

`scripts/check-release-ci.mjs` ignores Clippy. This skill does not. The `CI` workflow and `React Doctor` must both finish `success` on the SHA you tag.

## Wait

If `HEAD` is ahead of `origin/main`, push `main` first. The SHA you wait on is the SHA you will tag.

```bash
bash .agents/skills/fc-ship/scripts/wait-main-ci.sh "$(git rev-parse HEAD)"
```

Run it with the monitor tool. It stays silent until it prints `DONE` or `FAILED`.

On `FAILED`: open that job's log, fix the cause, commit, push, and run the waiter on the new SHA. Repeat until `DONE`.

## Release

`pnpm release` refuses any porcelain, including untracked files. Move `??` paths outside the repo, run the release, then move them back. Do that restore even when the command fails. Do not delete them.

In zsh, `status` is read-only. Do not use it as a shell variable.

```bash
aside=$(mktemp -d)
git status --porcelain | awk '/^\?\?/ {print substr($0, 4)}' | while IFS= read -r path; do
  mkdir -p "$aside/$(dirname "$path")"
  mv "$path" "$aside/$path"
done
pnpm release patch
code=$?
if [ -d "$aside" ]; then
  find "$aside" -mindepth 1 -maxdepth 1 -exec mv {} . \;
  rm -d "$aside" 2>/dev/null || true
fi
exit "$code"
```

Use `minor`, `major`, or an explicit version in place of `patch` when the user asked for that. The script fetches `origin/main`, checks `scripts/check-release-ci.mjs`, bumps `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, and `Cargo.lock`, commits `chore(release): bump version to X`, tags `vX`, and runs `git push --atomic origin main vX`. The push hook runs `pnpm verify:push`. Let it finish.

If preflight fails, stop and quote its message. Do not retry with `--force`.

## Report

Version, release commit, tag, and the `Release` workflow URL from `gh run list`. Do not wait for the three-platform build unless the user asks.
