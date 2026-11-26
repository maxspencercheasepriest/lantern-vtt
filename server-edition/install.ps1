# Lantern Server for Windows: installs (or updates the settings of) the always-on Lantern.
# Run Install.cmd rather than this file: it asks Windows for administrator rights first.
#   - keeps this folder where it is (move it somewhere permanent first, e.g. C:\Lantern Server)
#   - asks for a GM password and saves the settings in lantern.json (readable by administrators only)
#   - installs the "Lantern Server" Windows service: starts with Windows, restarts itself if it stops
#   - lets players on your home network in through the firewall
#   - optionally connects your own web address through a Cloudflare Tunnel
param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Service = Join-Path $Root 'lantern-service.exe'
$CfgPath = Join-Path $Root 'lantern.json'

function Say($text, $colour = 'Gray') { Write-Host $text -ForegroundColor $colour }
function Ask($question, $default) {
  $a = Read-Host "$question$(if ($default) { " [$default]" })"
  if ([string]::IsNullOrWhiteSpace($a)) { return $default } else { return $a.Trim() }
}

$me = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $me.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  Say 'Please run Install.cmd instead: it asks Windows for the administrator rights this needs.' Yellow
  exit 1
}

Say ''
Say '  Lantern Server' Yellow
Say '  ==============' Yellow
Say ''

# ---------- uninstall ----------
if ($Uninstall) {
  if (Test-Path $Service) { & $Service stop 2>$null | Out-Null; & $Service uninstall 2>$null | Out-Null }
  Remove-NetFirewallRule -DisplayName 'Lantern Server' -ErrorAction SilentlyContinue
  Say 'Lantern Server is stopped and removed. Your campaigns are still in the data folder:' Green
  Say "  $(Join-Path $Root 'data')"
  Say 'The Cloudflare tunnel (if you set one up) is left alone: remove it in Windows Settings > Apps, or with "cloudflared service uninstall".'
  exit 0
}

# ---------- somewhere permanent ----------
if ($Root -match '\\(Downloads|Desktop|AppData\\Local\\Temp)\\' -or $Root -match '\\Temp\\') {
  $target = 'C:\Lantern Server'
  Say "This folder is in $(Split-Path -Leaf (Split-Path -Parent $Root)). The service runs from wherever it's installed, so it's better somewhere permanent." Yellow
  if ((Ask "Move it to $target and install from there? (Y/n)" 'Y') -match '^[Yy]') {
    if (Test-Path (Join-Path $target 'start.mjs')) { Say "$target already has Lantern Server in it: install from there, or delete it first." Red; exit 1 }
    New-Item -ItemType Directory -Force -Path $target | Out-Null
    Copy-Item -Recurse -Force (Join-Path $Root '*') $target
    Say "Copied. Carrying on from $target..." Green
    & (Join-Path $target 'install.ps1')
    exit $LASTEXITCODE
  }
}

# files that came from the internet are marked as such; unmark ours so Windows runs them quietly
Get-ChildItem -Recurse -File $Root | Unblock-File -ErrorAction SilentlyContinue

# ---------- settings ----------
$cfg = [ordered]@{ port = 3000; dataDir = 'data'; accounts = $true; backupDays = 14 }
if (Test-Path $CfgPath) {
  $old = Get-Content -Raw $CfgPath | ConvertFrom-Json
  foreach ($p in $old.PSObject.Properties) { $cfg[$p.Name] = $p.Value }
  Say 'Found your settings from last time (lantern.json).' Green
}
if (-not $cfg.gmPassword) {
  Say 'Pick a GM password. You type it once, the first time you open Lantern, to make your own admin account.'
  while ($true) {
    $a = Read-Host 'GM password (8 or more characters)' -AsSecureString
    $b = Read-Host 'Type it again' -AsSecureString
    $pa = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($a))
    $pb = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($b))
    if ($pa.Length -lt 8) { Say 'That needs to be at least 8 characters.' Red; continue }
    if ($pa -ne $pb) { Say "Those didn't match. Try again." Red; continue }
    $cfg.gmPassword = $pa; break
  }
}
$cfg.port = [int](Ask 'Port' $cfg.port)
$busy = Get-NetTCPConnection -LocalPort $cfg.port -State Listen -ErrorAction SilentlyContinue
$ours = Get-Service -Name 'LanternServer' -ErrorAction SilentlyContinue
if ($busy -and -not $ours) { Say "Something else is already using port $($cfg.port). Run Install.cmd again and pick another (e.g. 3100)." Red; exit 1 }

# saved without a byte-order mark (Node won't read JSON that starts with one), and readable by administrators only
[IO.File]::WriteAllText($CfgPath, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
icacls $CfgPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null

# ---------- the service ----------
Say 'Installing the Lantern Server service...'
if ($ours) { & $Service stop 2>$null | Out-Null; Start-Sleep 2; & $Service uninstall | Out-Null; Start-Sleep 1 }
& $Service install | Out-Null
& $Service start | Out-Null

# ---------- firewall: players on your home network ----------
Remove-NetFirewallRule -DisplayName 'Lantern Server' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Lantern Server' -Direction Inbound -Protocol TCP -LocalPort $cfg.port -Action Allow -Profile Private,Domain | Out-Null

# ---------- is it up? ----------
$url = "http://localhost:$($cfg.port)"
$up = $false
for ($i = 0; $i -lt 30 -and -not $up; $i++) {
  Start-Sleep 1
  try { Invoke-WebRequest "$url/api/auth/status" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch { }
}
if ($up) { Say "Lantern Server is running: $url" Green }
else { Say "The service is installed but isn't answering yet. Look in $(Join-Path $Root 'logs') for what went wrong." Red }

# ---------- your own address (Cloudflare Tunnel) ----------
Say ''
Say 'Your own web address (e.g. https://lanternrpg.party)' Yellow
Say 'In Cloudflare: Zero Trust > Networks > Tunnels > Create a tunnel > Cloudflared. Name it "lantern".'
Say 'On the install page, copy the long token (the jumble of letters after "service install").'
Say "Then under Public hostname add your domain, with Service: HTTP and URL: localhost:$($cfg.port)."
$token = Ask 'Paste the tunnel token here (or press Enter to skip for now)' ''
if ($token) {
  $token = ($token -split '\s+')[-1]   # in case the whole "cloudflared service install <token>" line was pasted
  $cfDir = Join-Path $Root 'cloudflared'
  $cf = Join-Path $cfDir 'cloudflared.exe'
  New-Item -ItemType Directory -Force -Path $cfDir | Out-Null
  if (-not (Test-Path $cf)) {
    Say 'Downloading Cloudflare''s tunnel program...'
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe' -OutFile $cf -UseBasicParsing
  }
  & $cf service uninstall 2>$null | Out-Null
  & $cf service install $token
  if ($LASTEXITCODE -eq 0) { Say 'The tunnel is installed and starts with Windows. Give it a minute, then open your address.' Green }
  else { Say 'Cloudflare didn''t accept that. Check the token and run Install.cmd again (your other settings are kept).' Red }
}

Say ''
Say 'Next:' Yellow
Say "  1. Open $url on this computer (or your own address). Lantern asks for the GM password once, then you make your admin account."
Say '  2. My games > Start a new game, or bring your campaigns over from the desktop app (People > Bring campaigns in).'
Say '  3. Invite players from a game''s Players & invites button.'
Say ''
Say 'Updating later: People > This server > Check for updates. Uninstall: Uninstall.cmd (your campaigns are kept).'
if ($up) { Start-Process $url }
