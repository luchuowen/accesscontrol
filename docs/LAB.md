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

1. `bash scripts/package-cloud.sh /path/lango-app.tar.xz` (Next standalone + migrations + bundled migrate/seed).
2. Copy to `lab/deploy/lango-app.tar.xz`; queue an `.upload` to `/tmp/lango-app.tar.xz` and `deploy/setup-cloud.sh`
   as a `.cloud.sh` job. The script is idempotent: migrations always run, seed runs once
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
- Windows startup-script output can stop short of the final line; `run-on-vm.sh` treats 3 min of silence as done.
- Proof 1 passed: KES 10 payment → AxTraxNG user 21002 valid 2026-10-02 00:00–23:59, group `LG: gym`, card active,
  confirmed by the bridge ack 3.1 s after the payment was recorded. Lapsed members move to Unauthorized with cards
  inactive. Leftover group `LG: probe` (from the API probe) cannot be deleted through the REST API.
