# Leaflet Helper for Windows: does for Cartridge Sync what the Mac app does natively. "Start Leaflet.cmd" runs it; it
# opens Leaflet in an Edge (or Chrome) app window and answers that window on this computer only:
#   Play on melonDS        copies the game card's town next to your ROM backup, starts melonDS, keeps every save it
#                          writes, and hands the town back when melonDS closes
#   Install melonDS        the latest Windows build from melonDS's GitHub releases, checked against GitHub's SHA-256,
#                          into %LOCALAPPDATA%\Programs\melonDS (no administrator needed; its settings are kept)
#   melonDS's Wi-Fi ID     wfcsettings.bin next to melonDS.exe, so a town keeps its friend code
#   Saves on SD cards      looks through removable drives for Wild World saves
#   Install Leaflet Link   sends it to the Homebrew Launcher over Wi-Fi (like devkitPro's 3dslink)
# The page talks to it at http://127.0.0.1:<port>/ with a random token it gets in its address; anything else is refused.
# It closes by itself a minute after the Leaflet window is gone (or, while melonDS plays, after melonDS closes).
# Works in Windows PowerShell 5.1 and PowerShell 7. ASCII only, so 5.1 reads it correctly.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.IO.Compression.FileSystem
[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12

$here = Split-Path -Parent $MyInvocation.MyCommand.Path            # the app folder
$data = Join-Path $env:LOCALAPPDATA 'Leaflet'
$playDir = Join-Path $data 'Play'
$settingsFile = Join-Path $data 'helper-settings.json'
$infoFile = Join-Path $data 'helper.json'
$logFile = Join-Path $data 'helper.log'
New-Item -ItemType Directory -Force -Path $data | Out-Null
$SaveSize = 0x40000

function Log($text) { try { Add-Content -Path $logFile -Value ("{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $text) } catch { } }
function Stamp { return (Get-Date).ToString('yyyy-MM-dd HH.mm.ss') }
function B64([byte[]]$b) { return [Convert]::ToBase64String($b) }
function Prefix([byte[]]$b, [int]$n) { $o = New-Object byte[] $n; [Array]::Copy($b, $o, $n); return ,$o }
function SameBytes([byte[]]$a, [byte[]]$b) {
  if ($null -eq $a -or $null -eq $b -or $a.Length -ne $b.Length) { return $false }
  return [Convert]::ToBase64String($a) -eq [Convert]::ToBase64String($b)   # compared natively, not byte by byte in script
}
function ReadBytes($path) { if (Test-Path -LiteralPath $path) { return ,[IO.File]::ReadAllBytes($path) } return $null }
# Writes a file and reads it back to check every byte.
function WriteChecked($path, [byte[]]$bytes) {
  [IO.File]::WriteAllBytes($path, $bytes)
  if (-not (SameBytes (ReadBytes $path) $bytes)) { throw 'The file didn''t read back the same from disk.' }
}

# ---------- settings: the ROM backup and melonDS the person chose ----------
$settings = @{ rom = ''; emulator = '' }
if (Test-Path -LiteralPath $settingsFile) { try { $j = Get-Content -Raw -LiteralPath $settingsFile | ConvertFrom-Json; if ($j.rom) { $settings.rom = [string]$j.rom }; if ($j.emulator) { $settings.emulator = [string]$j.emulator } } catch { } }
function SaveSettings { $settings | ConvertTo-Json | Set-Content -LiteralPath $settingsFile -Encoding UTF8 }

# ---------- events for the page (it polls /events) ----------
$events = New-Object System.Collections.ArrayList
function Emit($fn, $arg) { [void]$events.Add(@{ fn = $fn; arg = $arg }) }

# ---------- melonDS ----------
$melonHome = Join-Path $env:LOCALAPPDATA 'Programs\melonDS'
function EmulatorPath {
  if ($settings.emulator -and (Test-Path -LiteralPath $settings.emulator)) { return $settings.emulator }
  foreach ($p in @((Join-Path $melonHome 'melonDS.exe'), (Join-Path $env:ProgramFiles 'melonDS\melonDS.exe'))) { if (Test-Path -LiteralPath $p) { return $p } }
  return ''
}
# melonDS on Windows keeps its settings (melonDS.toml, wfcsettings.bin) in its own folder.
function MelonDir { $e = EmulatorPath; if ($e) { return (Split-Path -Parent $e) } return '' }
function MelonRunning { return [bool](Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -like 'melonDS*' }) }
# Seconds melonDS adds to this computer's clock ("Offset" under [Instance0.RTC] in melonDS.toml).
function MelonClockOffset {
  $d = MelonDir; if (-not $d) { return 0 }
  $toml = Join-Path $d 'melonDS.toml'
  if (-not (Test-Path -LiteralPath $toml)) { return 0 }
  $section = ''
  foreach ($raw in [IO.File]::ReadAllLines($toml)) {
    $line = $raw.Trim()
    if ($line.StartsWith('[')) { $section = $line.Trim('[', ']', ' '); continue }
    $parts = $line.Split('=', 2)
    if ($parts.Count -ne 2) { continue }
    $key = $parts[0].Trim(); if ($section) { $key = "$section.$key" }
    if ($key -eq 'Instance0.RTC.Offset') { $n = 0; if ([int]::TryParse($parts[1].Trim(), [ref]$n)) { return $n } }
  }
  return 0
}
# The 4-letter game code in a DS ROM header (offset 0x0C), e.g. "ADME".
function GameCode($path) {
  try { $f = [IO.File]::OpenRead($path); try { $h = New-Object byte[] 16; if ($f.Read($h, 0, 16) -ne 16) { return '' }; return [Text.Encoding]::ASCII.GetString($h, 12, 4) } finally { $f.Close() } } catch { return '' }
}

# ---------- Play on melonDS ----------
# Everything lives in %LOCALAPPDATA%\Leaflet\Play (never OneDrive): a copy of the ROM backup, the save melonDS plays
# next to it, and what the session started from, so a session survives Leaflet being closed.
$romCopy = Join-Path $playDir 'Animal Crossing - Wild World.nds'
$saveFile = Join-Path $playDir 'Animal Crossing - Wild World.sav'
$sessionFile = Join-Path $playDir 'session.json'
$startFile = Join-Path $playDir 'start.sav'
$script:proc = $null; $script:lastSeen = $null; $script:nextCheck = Get-Date

function PendingSession {
  if (-not (Test-Path -LiteralPath $sessionFile) -or -not (Test-Path -LiteralPath $startFile) -or -not (Test-Path -LiteralPath $saveFile)) { return $null }
  $now = ReadBytes $saveFile
  if ($now.Length -lt $SaveSize) { return $null }
  $info = Get-Content -Raw -LiteralPath $sessionFile | ConvertFrom-Json
  return @{ town = [string]$info.town; cardCode = [string]$info.cardCode; started = $info.started; start = (B64 (ReadBytes $startFile)); data = (B64 (Prefix $now $SaveSize)); active = ($null -ne $script:proc) }
}
function EmuStatus {
  $s = @{ state = 'status'; running = (MelonRunning); playing = ($null -ne $script:proc); rtcOffset = (MelonClockOffset) }
  if ($settings.rom -and (Test-Path -LiteralPath $settings.rom)) { $s.rom = Split-Path -Leaf $settings.rom; $s.romCode = GameCode $settings.rom }
  if (EmulatorPath) { $s.emulator = 'melonDS' }
  $p = PendingSession; if ($p) { $s.pending = $p }
  return $s
}
function MoveSaveAside {
  if (Test-Path -LiteralPath $saveFile) {
    $older = Join-Path $playDir 'Earlier saves'
    New-Item -ItemType Directory -Force -Path $older | Out-Null
    Move-Item -LiteralPath $saveFile -Destination (Join-Path $older ((Stamp) + '.sav'))
  }
}
function Launch($exe) {
  $script:proc = Start-Process -FilePath $exe -ArgumentList ('"' + $romCopy + '"') -WorkingDirectory (Split-Path -Parent $exe) -PassThru
  $script:nextCheck = (Get-Date).AddSeconds(2)
  Emit 'LeafletEmu' @{ state = 'playing'; emulator = 'melonDS' }
}
function EmuPlay($m) {
  if ($script:proc) { throw 'melonDS is already playing a town from Leaflet.' }
  $save = [Convert]::FromBase64String([string]$m.data)
  $start = $save; if ($m.start) { $start = [Convert]::FromBase64String([string]$m.start) }
  if ($save.Length -ne $SaveSize) { throw 'The save must be 256 KB.' }
  $rom = $settings.rom
  if (-not $rom -or -not (Test-Path -LiteralPath $rom)) { throw 'Choose your ROM backup first.' }
  $code = GameCode $rom
  if (-not $code.StartsWith('ADM')) { throw 'Your ROM backup isn''t Animal Crossing: Wild World any more. Choose it again.' }
  if ($code -ne [string]$m.cardCode) { throw "Your ROM backup is the $code version, but the game card is $($m.cardCode). Saves only work with the same version." }
  $exe = EmulatorPath
  if (-not $exe) { throw 'Leaflet couldn''t find melonDS. Choose where it is.' }
  if (MelonRunning) { throw 'melonDS is already open. Close it first, so it starts with your town.' }
  if (PendingSession) { throw 'A town played earlier hasn''t been sent back or set aside yet.' }
  New-Item -ItemType Directory -Force -Path $playDir | Out-Null
  # The ROM copy: refreshed when the backup differs.
  $same = (Test-Path -LiteralPath $romCopy) -and ((Get-Item -LiteralPath $romCopy).Length -eq (Get-Item -LiteralPath $rom).Length) -and ((Get-FileHash -LiteralPath $romCopy -Algorithm SHA256).Hash -eq (Get-FileHash -LiteralPath $rom -Algorithm SHA256).Hash)
  if (-not $same) { Copy-Item -LiteralPath $rom -Destination $romCopy -Force }
  MoveSaveAside   # a save already here is moved aside, never overwritten
  WriteChecked $saveFile $save
  WriteChecked $startFile $start
  @{ town = [string]$m.town; cardCode = [string]$m.cardCode; started = [DateTimeOffset]::Now.ToUnixTimeSeconds() } | ConvertTo-Json | Set-Content -LiteralPath $sessionFile -Encoding UTF8
  $script:lastSeen = $save
  Launch $exe
}
function EmuResume {
  if ($script:proc) { throw 'melonDS is already playing.' }
  if (-not (PendingSession)) { throw 'There''s no town waiting in melonDS.' }
  $exe = EmulatorPath
  if (-not $exe) { throw 'Leaflet couldn''t find melonDS. Choose where it is.' }
  if (MelonRunning) { throw 'melonDS is already open. Close it first.' }
  if (-not (Test-Path -LiteralPath $romCopy)) { throw 'The ROM copy is missing. Set this town aside and start again.' }
  $script:lastSeen = ReadBytes $saveFile
  Launch $exe
}
function EmuClose {
  if ($script:proc) { return }
  MoveSaveAside
  Remove-Item -LiteralPath $sessionFile, $startFile -ErrorAction SilentlyContinue
}
# Every two seconds while melonDS plays: a new save goes to the page (which keeps it in Backups); when melonDS has
# closed, the session waits to be sent back.
function StepEmulator {
  if (-not $script:proc -or (Get-Date) -lt $script:nextCheck) { return }
  $script:nextCheck = (Get-Date).AddSeconds(2)
  try {
    $d = ReadBytes $saveFile
    if ($d -and $d.Length -ge $SaveSize -and -not (SameBytes $d $script:lastSeen)) { $script:lastSeen = $d; Emit 'LeafletEmu' @{ state = 'saved'; data = (B64 (Prefix $d $SaveSize)) } }
  } catch { }   # melonDS is writing it right now; next time
  if ($script:proc.HasExited) {
    $script:proc = $null
    $p = PendingSession
    if ($p) { $p.state = 'closed'; Emit 'LeafletEmu' $p }
  }
}

# ---------- choosing files ----------
function Owner { $f = New-Object Windows.Forms.Form; $f.TopMost = $true; $f.ShowInTaskbar = $false; $f.StartPosition = 'CenterScreen'; $f.Size = New-Object Drawing.Size(1, 1); $f.Show(); $f.Activate(); return $f }
function ChooseFile($title, $filter) {
  $o = Owner
  try { $d = New-Object Windows.Forms.OpenFileDialog; $d.Title = $title; $d.Filter = $filter; if ($d.ShowDialog($o) -eq 'OK') { return $d.FileName } return '' } finally { $o.Close() }
}
function ChooseFolder($title) {
  $o = Owner
  try { $d = New-Object Windows.Forms.FolderBrowserDialog; $d.Description = $title; if ($d.ShowDialog($o) -eq 'OK') { return $d.SelectedPath } return '' } finally { $o.Close() }
}

# ---------- melonDS's Wi-Fi settings (wfcsettings.bin next to melonDS.exe) ----------
function MelonWfc($write) {
  $dir = MelonDir
  $info = @{ running = (MelonRunning); installed = [bool]$dir; path = '' }
  if ($dir) {
    $file = Join-Path $dir 'wfcsettings.bin'; $info.path = $file
    if ($write) {
      if ($info.running) { $info.error = 'melonDS is open. Close it first, so it doesn''t write over the new settings.' }
      else {
        try {
          if (Test-Path -LiteralPath $file) { $b = "wfcsettings before Leaflet $(Stamp).bin"; Copy-Item -LiteralPath $file -Destination (Join-Path $dir $b); $info.backup = $b }
          WriteChecked $file ([Convert]::FromBase64String($write))
          $info.ok = $true
        } catch { $info.error = "$($_.Exception.Message)" }
      }
    }
    $now = ReadBytes $file
    if ($now) { $info.exists = $true; $info.data = B64 $now } else { $info.exists = $false }
  } else {
    $info.exists = $false
    if ($write) { $info.error = 'Install or choose melonDS first (Play on melonDS), then try again.' }
  }
  Emit 'LeafletMelonWfc' $info
}

# ---------- installing melonDS (step by step, so the window stays responsive) ----------
$script:dl = $null
function MelonInstall {
  if ($script:dl) { return }
  Emit 'LeafletMelonInstall' @{ state = 'checking' }
  try {
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/melonDS-emu/melonDS/releases/latest' -Headers @{ Accept = 'application/vnd.github+json'; 'User-Agent' = 'Leaflet' } -TimeoutSec 30
  } catch { Emit 'LeafletMelonInstall' @{ state = 'error'; error = 'Couldn''t reach GitHub to find melonDS. Check your internet connection.' }; return }
  $asset = @($release.assets | Where-Object { $_.name -match 'windows' -and $_.name -match '\.zip$' -and $_.name -notmatch 'arm' }) | Select-Object -First 1
  if (-not $asset) { Emit 'LeafletMelonInstall' @{ state = 'error'; error = 'The latest melonDS release has no Windows download.' }; return }
  # GitHub publishes each file's SHA-256; without it the download couldn't be checked, so it isn't installed.
  if (-not $asset.digest -or -not ([string]$asset.digest).StartsWith('sha256:')) { Emit 'LeafletMelonInstall' @{ state = 'error'; error = 'GitHub didn''t give a checksum for melonDS''s download, so Leaflet won''t install it. Download it from melonDS''s site instead.' }; return }
  try {
    $req = [Net.HttpWebRequest]::Create([string]$asset.browser_download_url)
    $req.UserAgent = 'Leaflet'; $req.ReadWriteTimeout = 30000; $req.Timeout = 30000
    $resp = $req.GetResponse()
    $tmp = Join-Path $env:TEMP ("leaflet-melonds-" + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $tmp | Out-Null
    $zip = Join-Path $tmp 'melonDS.zip'
    $script:dl = @{ resp = $resp; stream = $resp.GetResponseStream(); out = [IO.File]::Create($zip); total = $resp.ContentLength; done = 0; zip = $zip; tmp = $tmp; sha = ([string]$asset.digest).Substring(7).ToLower(); version = [string]$release.tag_name; buf = (New-Object byte[] 65536); last = -1 }
    Emit 'LeafletMelonInstall' @{ state = 'downloading'; progress = 0; version = $script:dl.version }
  } catch { Emit 'LeafletMelonInstall' @{ state = 'error'; error = "The download didn't start: $($_.Exception.Message)" } }
}
function StepDownload {
  $d = $script:dl; if (-not $d) { return }
  try {
    $until = (Get-Date).AddMilliseconds(120); $n = 1
    while ($n -gt 0 -and (Get-Date) -lt $until) {
      $n = $d.stream.Read($d.buf, 0, $d.buf.Length)
      if ($n -gt 0) { $d.out.Write($d.buf, 0, $n); $d.done += $n }
    }
    if ($n -gt 0) {
      if ($d.total -gt 0) { $pct = [int](100 * $d.done / $d.total); if ($pct -ne $d.last) { $d.last = $pct; Emit 'LeafletMelonInstall' @{ state = 'downloading'; progress = ($d.done / $d.total); version = $d.version } } }
      return
    }
    $d.out.Close(); $d.stream.Close(); $d.resp.Close()
    $script:dl = $null
    if ((Get-FileHash -LiteralPath $d.zip -Algorithm SHA256).Hash.ToLower() -ne $d.sha) { throw 'The download didn''t match the checksum GitHub published, so it wasn''t installed. Try again later.' }
    Emit 'LeafletMelonInstall' @{ state = 'installing'; version = $d.version }
    $out = Join-Path $d.tmp 'out'
    [IO.Compression.ZipFile]::ExtractToDirectory($d.zip, $out)
    $exe = Get-ChildItem -LiteralPath $out -Recurse -Filter 'melonDS.exe' | Select-Object -First 1
    if (-not $exe) { throw 'The download didn''t contain melonDS.exe.' }
    if (MelonRunning) { throw 'melonDS is open. Close it, then install again.' }
    # Copied over any earlier copy, so its settings (melonDS.toml, wfcsettings.bin) stay.
    New-Item -ItemType Directory -Force -Path $melonHome | Out-Null
    Copy-Item -Path (Join-Path $exe.DirectoryName '*') -Destination $melonHome -Recurse -Force
    $installed = Join-Path $melonHome 'melonDS.exe'
    if (-not (SameBytes (ReadBytes $installed) (ReadBytes $exe.FullName))) { throw 'melonDS didn''t copy correctly. Try again.' }
    Remove-Item -LiteralPath $d.tmp -Recurse -Force -ErrorAction SilentlyContinue
    $settings.emulator = $installed; SaveSettings
    Emit 'LeafletMelonInstall' @{ state = 'done'; version = $d.version; path = $installed }
    Emit 'LeafletEmu' (EmuStatus)
  } catch {
    if ($script:dl) { try { $d.out.Close(); $d.stream.Close(); $d.resp.Close() } catch { } }
    $script:dl = $null
    Remove-Item -LiteralPath $d.tmp -Recurse -Force -ErrorAction SilentlyContinue
    Emit 'LeafletMelonInstall' @{ state = 'error'; error = "$($_.Exception.Message)" }
    Emit 'LeafletEmu' (EmuStatus)
  }
}

# ---------- Wild World saves on SD cards and other drives ----------
# Files that start like a Wild World save (its region byte, 0x8A USA, 0xC5 Europe or 0x32 Japan/Korea, at the start
# of either copy of the town), a few folders deep. At most 60.
function FindSaves($roots) {
  $results = New-Object System.Collections.ArrayList
  $looked = 0
  foreach ($root in $roots) {
    $queue = New-Object System.Collections.Queue
    $queue.Enqueue(@($root, 0))
    while ($queue.Count -gt 0 -and $results.Count -lt 60 -and $looked -lt 20000) {
      $item = $queue.Dequeue(); $dir = $item[0]; $depth = $item[1]
      try { $entries = [IO.Directory]::GetFileSystemEntries($dir) } catch { continue }
      foreach ($e in $entries) {
        $looked++
        $name = [IO.Path]::GetFileName($e)
        if ($name.StartsWith('.')) { continue }
        if ([IO.Directory]::Exists($e)) { if ($depth -lt 6 -and $name -ne 'System Volume Information' -and $name -ne 'Nintendo 3DS') { $queue.Enqueue(@($e, $depth + 1)) }; continue }
        if ($name -notmatch '\.(sav|dsv|bin|sav[1-9])$') { continue }
        try {
          $fi = New-Object IO.FileInfo $e
          if ($fi.Length -lt $SaveSize -or $fi.Length -gt 0x100000) { continue }
          $b = [IO.File]::ReadAllBytes($e)
          $ok = @(0x8A, 0xC5, 0x32)
          if (-not ($ok -contains $b[0]) -and -not ($ok -contains $b[0x15FE0])) { continue }
          [void]$results.Add(@{ path = $e; name = $name; where = (Split-Path -Leaf $root); modified = [DateTimeOffset]::new($fi.LastWriteTimeUtc).ToUnixTimeMilliseconds(); data = (B64 $b) })
        } catch { }
      }
    }
  }
  $searched = @($roots | ForEach-Object { $_.TrimEnd('\') })
  Emit 'LeafletSaves' @{ results = $results.ToArray(); searched = $searched }
}
function RemovableDrives { return @([IO.DriveInfo]::GetDrives() | Where-Object { $_.DriveType -eq 'Removable' -and $_.IsReady } | ForEach-Object { $_.RootDirectory.FullName }) }

# ---------- installing Leaflet Link over Wi-Fi (the Homebrew Launcher's 3dslink protocol) ----------
function Discover3DS([int]$seconds) {
  $udp = New-Object System.Net.Sockets.UdpClient
  try {
    $udp.Client.SetSocketOption([Net.Sockets.SocketOptionLevel]::Socket, [Net.Sockets.SocketOptionName]::ReuseAddress, $true)
    $udp.Client.Bind((New-Object Net.IPEndPoint([Net.IPAddress]::Any, 17491)))
    $udp.EnableBroadcast = $true; $udp.Client.ReceiveTimeout = 300
    $ping = [Text.Encoding]::ASCII.GetBytes('3dsboot')
    $everyone = New-Object Net.IPEndPoint([Net.IPAddress]::Broadcast, 17491)
    $until = (Get-Date).AddSeconds($seconds)
    while ((Get-Date) -lt $until) {
      [void]$udp.Send($ping, $ping.Length, $everyone)
      try { $from = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0); $answer = $udp.Receive([ref]$from); if ([Text.Encoding]::ASCII.GetString($answer).StartsWith('boot3ds')) { return $from.Address.ToString() } } catch { }
    }
  } catch { } finally { $udp.Close() }
  return ''
}
function Install3DS([byte[]]$app, [string]$address) {
  if (-not $address) {
    Emit 'LeafletLinkInstall' @{ state = 'searching' }
    $address = Discover3DS 10
    if (-not $address) { Emit 'LeafletLinkInstall' @{ state = 'notFound' }; return }
  }
  Emit 'LeafletLinkInstall' @{ state = 'sending'; progress = 0; address = $address }
  $tcp = $null
  try {
    # zlib format: header, raw DEFLATE, Adler-32 of the original (big-endian).
    $ms = New-Object IO.MemoryStream
    $deflate = New-Object IO.Compression.DeflateStream($ms, [IO.Compression.CompressionMode]::Compress, $true)
    $deflate.Write($app, 0, $app.Length); $deflate.Close()
    [uint32]$a = 1; [uint32]$b = 0
    foreach ($x in $app) { $a = ($a + $x) % 65521; $b = ($b + $a) % 65521 }
    $adler = [BitConverter]::GetBytes([uint32](($b -shl 16) -bor $a)); [Array]::Reverse($adler)
    $packed = [byte[]](@(0x78, 0x9C) + $ms.ToArray() + $adler)
    $tcp = New-Object Net.Sockets.TcpClient
    if (-not $tcp.ConnectAsync($address, 17491).Wait(5000)) { throw "Couldn't reach the 3DS at $address. Is the Homebrew Launcher still waiting (press Y)?" }
    $net = $tcp.GetStream(); $net.ReadTimeout = 20000; $net.WriteTimeout = 20000
    $put = { param([byte[]]$d) $net.Write($d, 0, $d.Length) }
    $status = { $r = New-Object byte[] 4; $got = 0; while ($got -lt 4) { $n = $net.Read($r, $got, 4 - $got); if ($n -le 0) { throw 'The 3DS stopped answering.' }; $got += $n }; [BitConverter]::ToInt32($r, 0) }
    $name = [Text.Encoding]::UTF8.GetBytes('LeafletLink.3dsx')
    & $put ([BitConverter]::GetBytes([int32]$name.Length)); & $put $name; & $put ([BitConverter]::GetBytes([int32]$app.Length))
    switch (& $status) {
      0 { }
      -1 { throw 'The 3DS couldn''t create the file on its SD card. Is the card locked?' }
      -2 { throw 'The 3DS''s SD card is full.' }
      -3 { throw 'The 3DS ran out of memory. Restart the Homebrew Launcher and try again.' }
      default { throw 'The 3DS refused the app.' }
    }
    for ($at = 0; $at -lt $packed.Length; $at += 16384) {   # the launcher's buffer is 16 KB
      $len = [Math]::Min(16384, $packed.Length - $at)
      & $put ([BitConverter]::GetBytes([int32]$len)); $net.Write($packed, $at, $len)
    }
    if ((& $status) -ne 0) { throw 'The 3DS couldn''t save the app.' }
    $arg = [Text.Encoding]::UTF8.GetBytes("sdmc:/3ds/LeafletLink.3dsx`0")
    & $put ([BitConverter]::GetBytes([int32]$arg.Length)); & $put $arg
    Emit 'LeafletLinkInstall' @{ state = 'done'; address = $address }
  } catch { Emit 'LeafletLinkInstall' @{ state = 'error'; error = "$($_.Exception.Message)"; address = $address } }
  finally { if ($tcp) { $tcp.Close() } }
}

# ---------- commands from the page ----------
# Slow ones (searching drives, installing Leaflet Link) wait for the next turn of the loop, so the answer goes back first.
$script:later = $null
function Command($m) {
  try {
    switch ([string]$m.cmd) {
      'emuStatus' { Emit 'LeafletEmu' (EmuStatus) }
      'emuChooseRom' {
        $f = ChooseFile 'Choose the backup (.nds) you made from your own Wild World game card' 'DS game (*.nds)|*.nds'
        if ($f) { if (-not (GameCode $f).StartsWith('ADM')) { $s = EmuStatus; $s.state = 'error'; $s.error = 'That file isn''t Animal Crossing: Wild World.'; Emit 'LeafletEmu' $s; return }; $settings.rom = $f; SaveSettings }
        Emit 'LeafletEmu' (EmuStatus)
      }
      'emuChooseEmulator' { $f = ChooseFile 'Choose melonDS.exe' 'melonDS (melonDS.exe)|melonDS*.exe|Programs (*.exe)|*.exe'; if ($f) { $settings.emulator = $f; SaveSettings }; Emit 'LeafletEmu' (EmuStatus) }
      'emuPlay' { EmuPlay $m }
      'emuResume' { EmuResume }
      'emuClose' { EmuClose; Emit 'LeafletEmu' (EmuStatus) }
      'melonInstall' { MelonInstall }
      'melonWfcRead' { MelonWfc $null }
      'melonWfcWrite' { MelonWfc ([string]$m.data) }
      'findSaves' { $script:later = @{ kind = 'find'; roots = (RemovableDrives) } }
      'findSavesIn' { $f = ChooseFolder 'Choose an SD card or folder to search for Wild World saves'; if ($f) { $script:later = @{ kind = 'find'; roots = @($f) } } else { Emit 'LeafletSaves' @{ results = @(); searched = @() } } }
      'install3ds' { $script:later = @{ kind = 'install'; app = [Convert]::FromBase64String([string]$m.data); address = ([string]$m.address).Trim() } }
      default { }
    }
  } catch {
    Log "$($m.cmd): $($_.Exception.Message)"
    if ([string]$m.cmd -like 'emu*') { Emit 'LeafletEmu' @{ state = 'error'; error = "$($_.Exception.Message)" } }
  }
}

# ---------- the server (this computer only) ----------
function Json($o) { return ConvertTo-Json -InputObject $o -Depth 6 -Compress }
function Reply($stream, [int]$code, [string]$body) {
  $text = @{ 200 = 'OK'; 204 = 'No Content'; 400 = 'Bad Request'; 403 = 'Forbidden'; 404 = 'Not Found' }[$code]
  $b = [Text.Encoding]::UTF8.GetBytes($body)
  $h = "HTTP/1.1 $code $text`r`nContent-Type: application/json; charset=utf-8`r`nContent-Length: $($b.Length)`r`nCache-Control: no-store`r`n" +
       "Access-Control-Allow-Origin: *`r`nAccess-Control-Allow-Methods: GET, POST, OPTIONS`r`nAccess-Control-Allow-Headers: Content-Type`r`nAccess-Control-Allow-Private-Network: true`r`nConnection: close`r`n`r`n"
  $hb = [Text.Encoding]::ASCII.GetBytes($h)
  $stream.Write($hb, 0, $hb.Length); if ($b.Length) { $stream.Write($b, 0, $b.Length) }
}
function TakeEvents { $list = $events.ToArray(); $events.Clear(); return (Json @($list)) }

function Serve($client) {
  $client.ReceiveTimeout = 5000; $client.SendTimeout = 5000
  $stream = $client.GetStream()
  try {
    # Headers, then a body of Content-Length bytes.
    $buf = New-Object IO.MemoryStream; $chunk = New-Object byte[] 65536; $hdrEnd = -1; $need = 0
    while ($true) {
      $n = $stream.Read($chunk, 0, $chunk.Length); if ($n -le 0) { return }
      $buf.Write($chunk, 0, $n)
      $all = $buf.GetBuffer(); $len = [int]$buf.Length
      if ($hdrEnd -lt 0) {
        for ($i = 3; $i -lt $len; $i++) { if ($all[$i - 3] -eq 13 -and $all[$i - 2] -eq 10 -and $all[$i - 1] -eq 13 -and $all[$i] -eq 10) { $hdrEnd = $i + 1; break } }
        if ($hdrEnd -lt 0) { if ($len -gt 65536) { return }; continue }
        $head = [Text.Encoding]::ASCII.GetString($all, 0, $hdrEnd)
        if ($head -match '(?im)^content-length:\s*(\d+)') { $need = [int]$Matches[1] }
        if ($need -gt 16MB) { return }
      }
      if ($len - $hdrEnd -ge $need) { break }
    }
    $lines = $head -split "`r`n"
    $method, $target = $lines[0].Split(' ')[0, 1]
    $script:lastRequest = Get-Date
    if ($method -eq 'OPTIONS') { Reply $stream 204 ''; return }
    # Only this window: the right host (no DNS rebinding), no other website's origin, and the token.
    $hostOk = $head -match "(?im)^host:\s*127\.0\.0\.1:$port\s*$"
    $origin = if ($head -match '(?im)^origin:\s*(\S+)') { $Matches[1] } else { '' }
    $path, $query = $target.Split('?', 2)
    $t = ''; if ($query -match '(^|&)t=([0-9a-f]+)') { $t = $Matches[2] }
    if (-not $hostOk -or ($origin -and $origin -ne 'null') -or $t -ne $token) { Reply $stream 403 '{"error":"Not for you."}'; return }
    switch ($path) {
      '/ping' { Reply $stream 200 '{"app":"Leaflet Helper","version":1}' }
      '/events' { Reply $stream 200 (TakeEvents) }
      '/cmd' {
        $body = [Text.Encoding]::UTF8.GetString($buf.GetBuffer(), $hdrEnd, $need)
        $m = $body | ConvertFrom-Json
        Command $m
        Reply $stream 200 (TakeEvents)
      }
      default { Reply $stream 404 '{"error":"Unknown request."}' }
    }
  } catch { Log "request: $($_.Exception.Message)" }
  finally { try { $stream.Close() } catch { }; $client.Close() }
}

# ---------- start ----------
$page = Join-Path $here 'index.html'
function OpenWindow($query) {
  $url = ([Uri]$page).AbsoluteUri + $query
  $profile = Join-Path $data 'profile'
  $browsers = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
                "$env:ProgramFiles\Google\Chrome\Application\chrome.exe", "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe", "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe")
  foreach ($b in $browsers) {
    if ($b -and (Test-Path -LiteralPath $b)) {
      Start-Process -FilePath $b -ArgumentList @("--app=`"$url`"", "--user-data-dir=`"$profile`"", '--window-size=1240,820', '--no-first-run')
      return
    }
  }
  Start-Process $url   # no Edge or Chrome: the default browser
}

# A helper that's already running serves this window too.
if (Test-Path -LiteralPath $infoFile) {
  try {
    $old = Get-Content -Raw -LiteralPath $infoFile | ConvertFrom-Json
    $c = New-Object Net.WebClient
    $pong = $c.DownloadString("http://127.0.0.1:$($old.port)/ping?t=$($old.token)")
    if ($pong -match 'Leaflet Helper') { OpenWindow "?helper=$($old.port)&t=$($old.token)"; Set-Content -LiteralPath (Join-Path $data 'helper-started') -Value 'ok'; exit 0 }
  } catch { }
}

$token = -join ((1..32) | ForEach-Object { '{0:x}' -f (Get-Random -Maximum 16) })
$listener = $null; $port = 0
foreach ($p in 8227..8240) {
  try { $l = New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback, $p); $l.Start(); $listener = $l; $port = $p; break } catch { }
}
if (-not $listener) { Log 'no free port'; OpenWindow ''; Set-Content -LiteralPath (Join-Path $data 'helper-started') -Value 'without helper'; exit 0 }
@{ port = $port; token = $token; pid = $PID } | ConvertTo-Json | Set-Content -LiteralPath $infoFile -Encoding UTF8
OpenWindow "?helper=$port&t=$token"
Set-Content -LiteralPath (Join-Path $data 'helper-started') -Value 'ok'
Log "listening on $port"

$script:lastRequest = Get-Date
try {
  while ($true) {
    if ($listener.Pending()) { Serve $listener.AcceptTcpClient() } else { Start-Sleep -Milliseconds 25 }
    if ($script:later) {
      $job = $script:later; $script:later = $null
      try { if ($job.kind -eq 'find') { FindSaves @($job.roots) } else { Install3DS $job.app $job.address } } catch { Log "later: $($_.Exception.Message)" }
    }
    StepDownload
    StepEmulator
    # The Leaflet window polls every second; a minute without it (and nothing under way) means it's closed.
    if (((Get-Date) - $script:lastRequest).TotalSeconds -gt 60 -and -not $script:proc -and -not $script:dl) { break }
  }
} finally {
  $listener.Stop()
  Remove-Item -LiteralPath $infoFile -ErrorAction SilentlyContinue
  Log 'closed'
}
