import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

/**
 * GET /bridge/install.ps1 — the NAVAC Bridge installer for an AxTraxNG server PC. Run in an elevated PowerShell:
 *   irm https://<lango>/bridge/install.ps1 | iex
 * It asks for the club's pairing code and the AxTraxNG operator login on the PC itself; the AxTraxNG password never
 * leaves the site. Re-running it upgrades the bridge in place and keeps its pairing and journal, unless a new pairing code is given (moving the PC to another club).
 * With $env:NAVAC_BRIDGE_UPGRADE = '1' on a paired PC it upgrades without questions. First installs used the 'Lango' folder
 * names; the installer carries their pairing, journal and settings over to the NAVAC Bridge folders and removes the old ones.
 */
export function GET(req: Request) {
  const bundle = join(process.cwd(), 'public', 'bridge', 'navac-bridge.mjs');
  if (!existsSync(bundle)) return new Response('bridge bundle not packaged', { status: 503 });
  const sha = createHash('sha256').update(readFileSync(bundle)).digest('hex');
  const cloud = (process.env.PUBLIC_URL ?? new URL(req.url).origin).replace(/\/$/, '');
  const script = TEMPLATE.replaceAll('__CLOUD__', cloud).replaceAll('__SHA__', sha);
  return new Response(script, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}

const TEMPLATE = String.raw`# NAVAC Bridge installer (Windows, run as Administrator on the AxTraxNG server PC)
$ErrorActionPreference = 'Stop'; [Net.ServicePointManager]::SecurityProtocol = 'Tls12'; $ProgressPreference = 'SilentlyContinue'
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Open PowerShell with "Run as administrator" and run the command again.' }
$cloud = '__CLOUD__'; $sha = '__SHA__'
$app = 'C:\Program Files\NAVAC Bridge'; $data = 'C:\ProgramData\NAVAC Bridge'
$oldApp = 'C:\Program Files\Lango Bridge'; $oldData = 'C:\ProgramData\Lango'
Write-Host ''; Write-Host '  NAVAC Bridge' -ForegroundColor Green; Write-Host '  Connects this AxTraxNG server to Lango. Doors keep working if the internet drops.'; Write-Host ''
New-Item -ItemType Directory -Force $app, $data | Out-Null
# First installs used the Lango folder names: stop that bridge and carry its pairing, journal and settings over.
$moved = $false
if ((Test-Path "$oldData\bridge.json") -and -not (Test-Path "$data\bridge.json")) {
  Write-Host '  Moving the existing bridge to the NAVAC Bridge folders...'
  foreach ($t in 'NAVAC Bridge', 'Lango Site Bridge') { Stop-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue }
  Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$oldApp*" } | Stop-Process -Force
  Start-Sleep 2
  foreach ($f in 'bridge.json', 'journal.json', 'site.json', 'bridge.log') { if (Test-Path "$oldData\$f") { Copy-Item "$oldData\$f" "$data\$f" -Force } }
  if ((Test-Path "$oldApp\node\node.exe") -and -not (Test-Path "$app\node\node.exe")) { Copy-Item "$oldApp\node" "$app\node" -Recurse -Force }
  $moved = $true
}
$paired = Test-Path "$data\bridge.json"
$quiet = $paired -and ($env:NAVAC_BRIDGE_UPGRADE -eq '1')
$code = ''
if ($quiet) { Write-Host '  Upgrading in place, keeping the pairing and the AxTraxNG login.' }
elseif ($paired) { $code = (Read-Host '  Already connected. To move this PC to another club, enter its pairing code (or press Enter to keep it)').Trim().ToUpper() } else { $code = (Read-Host '  Pairing code (partner console > Clubs > this club > Doors)').Trim().ToUpper() }
# On a PC that already runs the bridge, the saved AxTraxNG login is offered: press Enter to keep it.
$old = $null; try { $old = Get-Content "$data\site.json" -Raw -ErrorAction Stop | ConvertFrom-Json } catch {}
$defUrl = if ($old -and $old.AXTRAX_URL) { $old.AXTRAX_URL } else { 'http://localhost:8080' }
$defUser = if ($old -and $old.AXTRAX_USER) { $old.AXTRAX_USER } else { 'Administrator' }
if ($quiet) { $axUrl = $defUrl; $axUser = $defUser; $axPass = $old.AXTRAX_PASSWORD } else {
$axUrl = Read-Host "  AxTraxNG REST address [$defUrl]"; if (-not $axUrl) { $axUrl = $defUrl }
$axUser = Read-Host "  AxTraxNG operator [$defUser]"; if (-not $axUser) { $axUser = $defUser }
$hint = if ($old -and $old.AXTRAX_PASSWORD) { ' (Enter keeps the saved one)' } else { '' }
$sec = Read-Host "  AxTraxNG operator password$hint" -AsSecureString
$axPass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if (-not $axPass -and $old -and $old.AXTRAX_PASSWORD) { $axPass = $old.AXTRAX_PASSWORD }
}
Write-Host '  Checking the AxTraxNG login...'
try { $null = Invoke-RestMethod -UseBasicParsing -Method Post -Uri "$axUrl/token" -ContentType 'application/x-www-form-urlencoded' -Body @{ grant_type = 'password'; username = $axUser; password = $axPass } }
catch { throw "Could not sign in to the AxTraxNG REST API at $axUrl. Check the REST service is running and the operator login. ($($_.Exception.Message))" }
if (-not (Test-Path "$app\node\node.exe")) {
  Write-Host '  Downloading Node.js runtime...'
  Invoke-WebRequest -UseBasicParsing https://nodejs.org/dist/v22.20.0/node-v22.20.0-win-x64.zip -OutFile "$env:TEMP\navac-bridge-node.zip"
  Expand-Archive "$env:TEMP\navac-bridge-node.zip" "$env:TEMP\navac-bridge-node" -Force
  Move-Item "$env:TEMP\navac-bridge-node\node-v22.20.0-win-x64" "$app\node" -Force
}
Write-Host '  Downloading the NAVAC Bridge...'
Invoke-WebRequest -UseBasicParsing "$cloud/bridge/navac-bridge.mjs" -OutFile "$app\navac-bridge.mjs.new"
if ((Get-FileHash "$app\navac-bridge.mjs.new" -Algorithm SHA256).Hash.ToLower() -ne $sha) { throw 'Download check failed. Run the command again.' }
Stop-ScheduledTask -TaskName 'NAVAC Bridge' -ErrorAction SilentlyContinue
# Older installs ran as 'Lango Site Bridge': stop and remove it so only one bridge runs.
Stop-ScheduledTask -TaskName 'Lango Site Bridge' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'Lango Site Bridge' -Confirm:$false -ErrorAction SilentlyContinue
Get-Process node -ErrorAction SilentlyContinue | Where-Object { $_.Path -like "$app*" -or $_.Path -like "$oldApp*" } | Stop-Process -Force
Start-Sleep 2
Move-Item "$app\navac-bridge.mjs.new" "$app\navac-bridge.mjs" -Force
Remove-Item "$data\bridge.lock" -ErrorAction SilentlyContinue
# Moving to another club: forget the old pairing and its journal, so the new club starts clean.
if ($paired -and $code) { Remove-Item "$data\bridge.json", "$data\journal.json" -ErrorAction SilentlyContinue }
# Site settings (incl. the AxTraxNG login) live in a JSON file only SYSTEM and Administrators can read.
$site = [ordered]@{ AXTRAX_URL = $axUrl; AXTRAX_USER = $axUser; AXTRAX_PASSWORD = $axPass }
if ($code) { $site.NAVAC_BRIDGE_PAIR_CODE = $code }
$site | ConvertTo-Json | Set-Content "$data\site.json" -Encoding UTF8
icacls "$data\site.json" /inheritance:r /grant:r 'SYSTEM:F' 'Administrators:F' | Out-Null
$lines = @('@echo off', "set NAVAC_BRIDGE_CLOUD=$cloud", "set NAVAC_BRIDGE_DATA=$data")
$lines += ('"' + "$app\node\node.exe" + '" "' + "$app\navac-bridge.mjs" + '" >> "' + "$data\bridge.log" + '" 2>&1')
$lines | Set-Content "$app\run.cmd" -Encoding ASCII
$act = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument ('/c "' + "$app\run.cmd" + '"')
$trg = New-ScheduledTaskTrigger -AtStartup
$set = New-ScheduledTaskSettingsSet -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -AllowStartIfOnBatteries
Register-ScheduledTask -TaskName 'NAVAC Bridge' -Action $act -Trigger $trg -Settings $set -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName 'NAVAC Bridge'
Write-Host '  Starting...'
for ($i = 0; $i -lt 20; $i++) {
  Start-Sleep 3
  if (Test-Path "$data\bridge.json") { break }
  $log = Get-Content "$data\bridge.log" -Tail 3 -ErrorAction SilentlyContinue
  if ($log -match 'pairing failed') { throw "Pairing failed: the code is wrong, used or expired. Get a new one on the Doors tab of the club in the partner console. ($($log -join ' '))" }
}
# The old Lango folders are no longer used (their settings were copied above).
if ($moved -or (Test-Path $oldApp)) { Remove-Item $oldApp -Recurse -Force -ErrorAction SilentlyContinue }
if ($moved) { Remove-Item $oldData -Recurse -Force -ErrorAction SilentlyContinue }
if (Test-Path "$data\bridge.json") { Write-Host '  Done. This site is connected to Lango; the Doors tab in the console updates by itself.' -ForegroundColor Green }
else { Write-Host "  Installed, still connecting. If the console does not show the bridge online within 2 minutes, send $data\bridge.log to support." -ForegroundColor Yellow }
`;
