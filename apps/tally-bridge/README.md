# Tally bridge

Two read-only tools for the Windows PC that runs Tally. Neither has a write path of any kind: every request is one of the fixed Exports in `src/templates.mjs`, and `assertReadOnly` refuses anything else before it leaves the program.

- **`src/check.mjs`** is the check tool (plan 09 section 5). One run, no install, no admin rights. It writes one HTML page to Documents and sends nothing.
- **`src/main.mjs`** with **`src/launcher.mjs`** is the bridge (plan 09 section 6). It fetches, gzips, queues and uploads. The server in `apps/api/src/tally` does all the reading and keeps every watermark.

There is no `package.json` here, so npm workspaces leave this folder alone. Everything uses Node's own built-in modules.

**Nothing here has run against real Tally, and nothing here has run on Windows.** `fake/fake-tally.mjs` answers the XML shapes plan 09 section 7 wrote down, which come from Tally's documents and community code. The bench in plan 09 section 7 must prove each read on each Tally line before the shop PC.

## Why Node and not Go

Plan 09 chose Go. Neither Go nor .NET is installed on this Mac, and the brief for this step said to use Node in that case, with no `pkg`. So what ships is plain `.mjs` plus Windows' own `node.exe`. What that costs against the plan:

| Plan 09 says | What this does | Why |
|---|---|---|
| One small `.exe` | A folder: `node.exe`, about 80 MB, and the `.mjs` files | Node's runtime is many times larger, which plan 09 knew |
| Under 50 MB memory | Over it. On a Mac the agent sat at 54 MB and bare Node at 38 MB, and the launcher is a second Node process, so expect about 90 MB. Not measured on Windows | Two runtimes, so a crashing core cannot stop its own rollback. Measure on the bench |
| Windows service, `NT SERVICE\ShivBridge` | A Task Scheduler task at boot, as LOCAL SERVICE, restart on failure | A plain Node program cannot answer the service manager without a native add-on or a third-party wrapper |
| Key protected with DPAPI | Key in `C:\ProgramData\ShivBridge`, by folder permissions only | Node has no DPAPI without a native add-on, and plan 09 rules out PowerShell |
| `SetThreadExecutionState` while uploading | Not done | Needs a native call. A PC that sleeps mid-upload resumes on wake, so this costs time, not data |
| Service power events | A wall-clock jump check only | Same reason |
| Authenticode | None, as decision 57 says. The update manifest is signed with an offline Ed25519 key | Windows will warn on install. Aman installs in person |

If Go becomes available, `templates.mjs`, the fake and the API do not change: the wire protocol is all in `api-client.mjs`.

## Tests

```sh
fnm exec --using=22 node --test apps/tally-bridge/test/bridge.test.mjs
```

The API's own tests (`apps/api/test/tally-*.test.ts`) drive the real program against the fake Tally, the real API and a real Postgres.

## Packaging, on the Mac

1. Make the update key once, somewhere outside this repository, and keep the private half offline:
   ```sh
   node apps/tally-bridge/tools/make-update-key.mjs ~/ShivBridgeKeys
   ```
2. Download Node's Windows build from `https://nodejs.org/dist/` (`latest-v22.x/node-v22.*-win-x64.zip`), and check it against `SHASUMS256.txt` from the same folder with `shasum -a 256`. Unzip it and take `node.exe`.
3. Build the folder and zip:
   ```sh
   apps/tally-bridge/packaging/build-windows.sh --update-key ~/ShivBridgeKeys/update-key.pub --node path/to/node.exe
   ```
   This writes `apps/tally-bridge/dist/ShivBridge-<version>.zip`. `dist/` is ignored by git. Never put a report or a key in this repository: it is public.

## On the Tally PC

**Check tool, with the accountant present.** Unzip anywhere, then double-click `ShivTallyCheck.cmd`. To include the clock and TLS check, run `ShivTallyCheck.cmd --api https://YOUR-API-ADDRESS`. It takes under 5 minutes and writes `Documents\ShivTallyCheck-<time>.html`.

**Bridge.** Windows will warn that the program is unsigned.

1. Right-click `install.cmd`, Run as administrator.
2. On the desk, an owner or the technical operator makes an 8-digit code: `POST admin/tally/devices/pair`. It lasts 15 minutes and works once.
3. As administrator:
   ```bat
   "%ProgramFiles%\ShivBridge\node.exe" "%ProgramFiles%\ShivBridge\app\main.mjs" pair 12345678 --api https://YOUR-API-ADDRESS
   schtasks /Run /TN ShivBridge
   ```
4. On the desk, the company appears as `PENDING`. Nothing is copied until a person says which file it is: `POST admin/tally/companies/:id` with `{"role":"PRIMARY"}`.

**To remove it,** run `uninstall.cmd` as administrator, then revoke the PC on the desk. It touches nothing in Tally.

## Updates

1. Raise `AGENT_VERSION` in `src/version.mjs`. The launcher waits for that exact version to report healthy.
2. `node apps/tally-bridge/tools/sign-release.mjs 1.1.0 ~/ShivBridgeKeys/update-key.pem release.json`
3. `POST admin/tally/releases` with that file, then `POST admin/tally/devices/:id/release` for one PC first.

The PC checks the offline signature, every file's hash, and that the version is newer, so a hacked API can neither change a file nor put an old one back. A version that fails to report healthy three times is removed and the old one comes back. The launcher itself never updates: a new launcher means a visit.
