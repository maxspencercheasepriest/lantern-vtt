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

# a click in this window would pause the install (QuickEdit), so switch that off while it runs
try {
  Add-Type -Name Con -Namespace Lantern -MemberDefinition '[DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int h); [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr h, out uint m); [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr h, uint m);'
  $h = [Lantern.Con]::GetStdHandle(-10); $m = 0
  if ([Lantern.Con]::GetConsoleMode($h, [ref]$m)) { [Lantern.Con]::SetConsoleMode($h, ($m -band (-bnot 0x40)) -bor 0x80) | Out-Null }
} catch { }

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

# ---------- your web address ----------
Say ''
Say 'Your web address' Yellow
Say 'With your own domain on Cloudflare (e.g. lanternrpg.party): Zero Trust > Networks > Tunnels > Create a tunnel >'
Say 'Cloudflared, name it "lantern", copy the long token (the jumble after "service install"), and under'
Say "Public hostname add your domain with Service: HTTP and URL: localhost:$($cfg.port)."
$token = Ask 'Paste the tunnel token (or press Enter if you have no domain yet)' ''
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
  if ($LASTEXITCODE -eq 0) { Say 'Your own address is connected: it starts with Windows. Give it a minute, then open it.' Green; $cfg.quickTunnel = $false }
  else { Say 'Cloudflare didn''t accept that token. Check it and run Install.cmd again (your other settings are kept).' Red }
} elseif (-not (Get-Service -Name 'Cloudflared' -ErrorAction SilentlyContinue)) {
  Say 'No domain yet? Lantern can use a free temporary address (https://something-random.trycloudflare.com)'
  Say 'until you have one. It changes whenever the server restarts, so you''d send players the new one.'
  $cfg.quickTunnel = ((Ask 'Use a temporary address for now? (Y/n)' 'Y') -match '^[Yy]')
}

# saved without a byte-order mark (Node won't read JSON that starts with one), and readable by administrators only
[IO.File]::WriteAllText($CfgPath, ($cfg | ConvertTo-Json), (New-Object Text.UTF8Encoding $false))
icacls $CfgPath /inheritance:r /grant:r '*S-1-5-18:(F)' '*S-1-5-32-544:(F)' | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $Root 'logs') | Out-Null

# ---------- the service ----------
Say ''
Say 'Installing the Lantern Server service...'
$addrFile = Join-Path (Join-Path $Root 'data') 'temporary-address.txt'
Remove-Item $addrFile -ErrorAction SilentlyContinue
if ($ours) { & $Service stop 2>$null | Out-Null; Start-Sleep 2; & $Service uninstall | Out-Null; Start-Sleep 1 }
& $Service install | Out-Null
& $Service start | Out-Null

# ---------- firewall: players on your home network ----------
Remove-NetFirewallRule -DisplayName 'Lantern Server' -ErrorAction SilentlyContinue
New-NetFirewallRule -DisplayName 'Lantern Server' -Direction Inbound -Protocol TCP -LocalPort $cfg.port -Action Allow -Profile Private,Domain | Out-Null

# ---------- is it up? ----------
$url = "http://localhost:$($cfg.port)"
$up = $false
Say 'Starting it (the first start can take a minute while Windows checks the files)...'
for ($i = 0; $i -lt 120 -and -not $up; $i++) {
  Start-Sleep 1
  try { Invoke-WebRequest "$url/api/auth/status" -UseBasicParsing -TimeoutSec 2 | Out-Null; $up = $true } catch { }
}
if ($up) { Say "Lantern Server is running: $url" Green }
else { Say "The service is installed but isn't answering yet. Give it a minute and open $url ; if it still doesn't load, look in $(Join-Path $Root 'logs')." Yellow }

$open = $url
if ($cfg.quickTunnel) {
  Say 'Asking Cloudflare for a temporary address...'
  for ($i = 0; $i -lt 60 -and -not (Test-Path $addrFile); $i++) { Start-Sleep 1 }
  if (Test-Path $addrFile) {
    $open = (Get-Content $addrFile -TotalCount 1).Trim()
    Say "Your temporary address: $open" Green
    Say 'Send players that one. It changes when the server restarts: the current one is always under People > This server.'
  } else { Say 'Cloudflare hasn''t answered yet. The address will show up under People > This server once it does.' Yellow }
}

Say ''
Say 'Next:' Yellow
Say "  1. Open $open . Lantern asks for the GM password once, then you make your own admin account."
Say '  2. Create new game, or bring your campaigns over from the desktop app (People > Bring campaigns in).'
Say '  3. Invite players from a game''s Players & invites button.'
Say ''
Say 'Updating later: People > This server > Check for updates. Uninstall: Uninstall.cmd (your campaigns are kept).'
if ($up) { Start-Process $open }
