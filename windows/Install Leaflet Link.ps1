# Installs Leaflet Link (Cartridge Sync's 3DS app) over Wi-Fi, like devkitPro's 3dslink: the Homebrew Launcher,
# with Y pressed, answers a "3dsboot" broadcast on UDP 17491, takes the app over TCP 17491, saves it to
# sdmc:/3ds/LeafletLink.3dsx and starts it. Run by "Install Leaflet Link.cmd". Works in Windows PowerShell 5.1 and 7.
param([string]$Address = '')
$ErrorActionPreference = 'Stop'
$Port = 17491
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$appPath = Join-Path $here 'LeafletLink.3dsx'   # both live in the app folder of the Windows download

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Finish($code) { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null; exit $code }

Say ''
Say '  Leaflet Link installer' 'Green'
Say '  Puts Leaflet Link on your 3DS over Wi-Fi, for Cartridge Sync.'
Say ''
if (-not (Test-Path $appPath)) { Say "  LeafletLink.3dsx isn't next to this installer." 'Red'; Finish 1 }
$app = [IO.File]::ReadAllBytes($appPath)

if (-not $Address) {
  Say '  1. On your 3DS, open the Homebrew Launcher.'
  Say '  2. Press Y. It says it''s waiting for a connection.'
  Say ''
  Read-Host '  Then press Enter here' | Out-Null
  Say '  Looking for your 3DS...'
  $udp = New-Object System.Net.Sockets.UdpClient
  try {
    $udp.Client.SetSocketOption([Net.Sockets.SocketOptionLevel]::Socket, [Net.Sockets.SocketOptionName]::ReuseAddress, $true)
    $udp.Client.Bind((New-Object Net.IPEndPoint([Net.IPAddress]::Any, $Port)))
    $udp.EnableBroadcast = $true
    $udp.Client.ReceiveTimeout = 300
    $ping = [Text.Encoding]::ASCII.GetBytes('3dsboot')
    $everyone = New-Object Net.IPEndPoint([Net.IPAddress]::Broadcast, $Port)
    $until = (Get-Date).AddSeconds(10)
    while (-not $Address -and (Get-Date) -lt $until) {
      [void]$udp.Send($ping, $ping.Length, $everyone)
      try {
        $from = New-Object Net.IPEndPoint([Net.IPAddress]::Any, 0)
        $answer = $udp.Receive([ref]$from)
        if ([Text.Encoding]::ASCII.GetString($answer).StartsWith('boot3ds')) { $Address = $from.Address.ToString() }
      } catch { }   # nothing yet (the receive timed out)
    }
  } catch { } finally { $udp.Close() }
  if ($Address) { Say "  Found it at $Address." 'Green' }
  else {
    Say '  Couldn''t find it automatically (a firewall can block that).' 'Yellow'
    $Address = (Read-Host '  Type the address on the 3DS screen, like 192.168.1.23').Trim()
    $Address = ($Address -split ':')[0]
  }
}

function Int32Bytes([int]$n) { return [BitConverter]::GetBytes([int32]$n) }   # little-endian, as the launcher reads it

# zlib format: header, raw DEFLATE, Adler-32 of the original (big-endian).
$ms = New-Object IO.MemoryStream
$deflate = New-Object IO.Compression.DeflateStream($ms, [IO.Compression.CompressionMode]::Compress, $true)
$deflate.Write($app, 0, $app.Length); $deflate.Close()
[uint32]$a = 1; [uint32]$b = 0
foreach ($x in $app) { $a = ($a + $x) % 65521; $b = ($b + $a) % 65521 }
$adler = [BitConverter]::GetBytes([uint32](($b -shl 16) -bor $a)); [Array]::Reverse($adler)
$packed = [byte[]](@(0x78, 0x9C) + $ms.ToArray() + $adler)

try {
  $tcp = New-Object Net.Sockets.TcpClient
  if (-not $tcp.ConnectAsync($Address, $Port).Wait(5000)) { throw 'no answer' }
} catch { Say "  Couldn't reach the 3DS at $Address. Is the Homebrew Launcher still waiting (press Y)?" 'Red'; Finish 1 }
$net = $tcp.GetStream(); $net.ReadTimeout = 20000; $net.WriteTimeout = 20000
function Put([byte[]]$d) { $net.Write($d, 0, $d.Length) }
function Status { $r = New-Object byte[] 4; $got = 0; while ($got -lt 4) { $n = $net.Read($r, $got, 4 - $got); if ($n -le 0) { throw 'The 3DS stopped answering.' }; $got += $n }; return [BitConverter]::ToInt32($r, 0) }

try {
  $name = [Text.Encoding]::UTF8.GetBytes('LeafletLink.3dsx')
  Put (Int32Bytes $name.Length); Put $name; Put (Int32Bytes $app.Length)
  switch (Status) {
    0 { }
    -1 { throw 'The 3DS couldn''t create the file on its SD card. Is the card locked?' }
    -2 { throw 'The 3DS''s SD card is full.' }
    -3 { throw 'The 3DS ran out of memory. Restart the Homebrew Launcher and try again.' }
    default { throw 'The 3DS refused the app.' }
  }
  for ($at = 0; $at -lt $packed.Length; $at += 16384) {   # the launcher's buffer is 16 KB
    $len = [Math]::Min(16384, $packed.Length - $at)
    Put (Int32Bytes $len); $net.Write($packed, $at, $len)
    Write-Progress -Activity 'Sending Leaflet Link to your 3DS' -PercentComplete ([int](100 * ($at + $len) / $packed.Length))
  }
  Write-Progress -Activity 'Sending Leaflet Link to your 3DS' -Completed
  if ((Status) -ne 0) { throw 'The 3DS couldn''t save the app.' }
  $arg = [Text.Encoding]::UTF8.GetBytes("sdmc:/3ds/LeafletLink.3dsx`0")
  Put (Int32Bytes $arg.Length); Put $arg
  $tcp.Close()
} catch { Say "  $_" 'Red'; Finish 1 }

Say ''
Say '  Leaflet Link is installed and starting on your 3DS.' 'Green'
Say "  In Leaflet, open Cartridge Sync and type: $Address"
Say '  Next time, open Leaflet Link from the Homebrew Launcher.'
Finish 0
