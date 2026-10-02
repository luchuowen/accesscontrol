# Lab environment (mirror of John's setup)

All lab resources live in GCP project **navac-lango-lab** (billing: "My Billing Account 2", budget alert USD 20/month
at 50/90/100 %). Delete the project to remove everything.

| Resource | What | Cost control |
|---|---|---|
| `lango-axtrax` (africa-south1-a) | Windows Server 2019, e2-standard-2, 60 GB: AxTraxNG 27.7.1.20 + SQL Express (VERITRAX) + AxTraxNG REST API 2.0 + Lango Site Bridge (scheduled task "Lango Site Bridge") | Stops itself daily 21:00 Nairobi (`lango-nightly-stop`). Bills only while running + disk. |
| `lango-cloud` (us-central1-a) | Debian 12 e2-micro (free tier): Postgres 15, Node 22, Caddy (auto HTTPS), Lango web as `lango-web.service` | Free tier eligible. |
| URL | `https://lango.34-71-138-135.sslip.io` (console `/`, member portal `/m`) | — |

Remote desktop to the Windows VM: Chrome Remote Desktop (host registered to luchuowen@gmail.com).
RDP 3389 is open only to Owen's IP (`lango-rdp-owen`).

## Autopilot (how Claude operates the lab without a GCP credential)

`~/Desktop/Now/AccessControl/lab/autopilot2.sh` runs in Owen's Mac Terminal with his gcloud login and executes
job files dropped into `lab/queue/`, writing output to `lab/results/`:

- `NAME.ps1` → runs on `lango-axtrax` as a startup script (restarts/starts the VM), prints `LANGO:` lines.
- `NAME.cloud.sh` → runs as root on `lango-cloud` over `gcloud compute ssh`.
- `NAME.upload` → `local remote` pairs copied to `lango-cloud` with `gcloud compute scp`.
- `push` → applies `lab/repo.bundle` to the Mac clone and pushes to GitHub.
- `NAME.diag` → Windows VM status + serial tail. `lab/autopilot.next` self-updates the runner.

## Deploy the cloud app

1. `bash scripts/package-cloud.sh /path/lango-app-vN.tar.xz` (Next standalone + migrations + bundled migrate/seed).
2. Copy to `lab/deploy/lango-app-vN.tar.xz` (new N every time); queue an `.upload` to `/tmp/lango-app.tar.xz` and
   `deploy/setup-cloud.sh` as a `.cloud.sh` job. The script is idempotent: migrations always run, seed runs once
   (`/etc/lango.seeded`), secrets live in `/etc/lango.env` (root, 600).

## Windows VM facts (from the silent install)

- AxTraxNG installer unpacks to `%TEMP%\AxTraxNGSetup\` (Server/Client/Server Monitor MSIs, `Add on\SQLEXPRESS.exe`,
  `Add on\IniSQL.ini`: instance `(local)\Veritrax`, database `AxTrax1`).
- REST API installer is **Inno Setup** → `/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-`.
- Startup scripts run as SYSTEM in session 0: GUI installers hang there — always use silent switches.
- `Invoke-WebRequest` needs `-UseBasicParsing` on a fresh Server 2019 profile.

## Lessons from the lab (2026-10-01)
- Never overwrite a staged file in `lab/` by re-committing the same path from the cloud workspace: use a new
  versioned name (`lango-app-v3.tar.xz`). Two "updates" silently shipped stale files this way.
- A file edited after it was first written in the cloud workspace can still ship in its first version. Copy the final
  content to a fresh name before sending it, and compare the checksum on the Mac before queueing.
- Windows startup-script output can stop short of the final line; `run-on-vm.sh` treats 3 min of silence as done.
- Proof 1 passed: KES 10 payment → AxTraxNG user 21002 valid 2026-10-02 00:00–23:59, group `LG: gym`, card active,
  confirmed by the bridge ack 3.1 s after the payment was recorded. Lapsed members move to Unauthorized with cards
  inactive. Leftover group `LG: probe` (from the API probe) cannot be deleted through the REST API.

## Update the Site Bridge
Bundle `apps/bridge/src/main.ts` with esbuild (node22 ESM), gzip+base64 it into a `.ps1` job that stops the task, writes
`lango-bridge.mjs`, checks its SHA-256, removes `bridge.lock` and starts the task (pattern: `lab/hold/5x-*.ps1`).
Every `.ps1` job reboots the Windows VM; the REST service answers ~2 min after boot.

## Proof 2 (2026-10-02, after two review passes)
- Cloud v4 (migration 0003) + bridge `437815aa`: KES 10 renewal for 21002 extended 2 Oct → 3 Oct 23:59 (renewal
  from current end), applied in AxTraxNG 3.75 s after the payment; 34/34 states applied, 0 errors.
- App role: `staff_users` permission denied; login works through `app_staff_login`.
- Real AxTraxNG: `PUT AccessGroup/UpdateAccessGroup` works; `GetAccessGroups` includes `TimezoneReaders`.
- Found and fixed: users created with no validity dates (never paid) stored 1900-01-01 / bValidDate false, and later
  updates did not stick, so the Tamper Guard reported them every pass. Never-paid members now get a past one-day
  window (2000-01-01 00:00–23:59) and the bridge re-reads after every user update and fails loudly if it did not land.

## Proof 4 (2026-10-02): real TaifaPay money
- Lango merchant on TaifaPay Live; keys verified through `/api/v1/auth/token`.
- Real KES 10 STK to 0726049097 → TaifaPay "Complete", but **no webhook arrived**. Settling the transaction by id
  (re-query) applied it: 21002 extended to 4 Oct 23:59, intent completed. The 60 s reconciliation poller now does
  this automatically.

## Onboarding a club (partner)
1. Sign in → Clubs → **Add a club** (name, owner name + email) → hand over console address, one-time password,
   pairing code.
2. On the AxTraxNG server PC (PowerShell as Administrator): `irm https://<lango>/bridge/install.ps1 | iex`.
3. In the club console: Doors & access → map zones to readers → import members; Plans; Settings → TaifaPay keys,
   paybill/till, settlement. The checklist on Overview shows what is left.
