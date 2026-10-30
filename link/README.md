# Leaflet Link

Leaflet Link is a small 3DS app for **Cartridge Sync**. It lets Leaflet read the save on your *Animal Crossing: Wild
World* game card over Wi-Fi, and write a town back to the card. Use it to edit your real town, or to play on an
emulator with sharper graphics and then put the town back on the card.

> [!WARNING]
> Leaflet Link has been tested end to end against a simulated game card, including the failures below, and on a real
> 3DS, but **try it first with a game card whose save you've already backed up.** Leaflet Link keeps a backup of the
> save on your SD card before it writes, every time.

## Leaflet on your phone

Leaflet Link carries Leaflet itself (since 2.0). With Leaflet Link open, scan the QR code on the 3DS's lower screen
with a phone or tablet on the same Wi-Fi (or type the address shown under it): Leaflet opens straight from the 3DS
and connects to it by itself. Cartridge Sync on a computer shows the same code. Saves and backups made on the phone
are also kept in Leaflet Link's backups folder, so they list on the 3DS and come back if its address changes.

## Updates

Leaflet Link has the same version number as Leaflet. When Leaflet connects to an older Leaflet Link it sends the one
it carries; the 3DS asks for **A** before installing it, then you open Leaflet Link again.

## Installing it

You need a 3DS that can run homebrew. Leaflet Link only has to be installed once.

- **Over Wi-Fi, from Leaflet** (the Mac app, or Windows when you open Leaflet with **Start Leaflet**): on the 3DS,
  open the Homebrew Launcher and press **Y**. In Leaflet, open **Cartridge Sync** and click **Send to my 3DS**.
  Leaflet finds the 3DS, installs Leaflet Link in the SD card's `3ds` folder, starts it and connects to it.
- **Windows, with the installer:** double-click **Install Leaflet Link** in the Leaflet folder. Press **Y** in the
  Homebrew Launcher, then Enter in the installer.
- **By hand:** copy `LeafletLink.3dsx` (from Cartridge Sync or the release) into the `3ds` folder on the SD card.

The wireless installs use the Homebrew Launcher's own receiver (the protocol devkitPro's `3dslink` uses). If the 3DS
isn't found automatically, type the address the launcher shows. A firewall can block the automatic search.

**Updates** need no cable either. When Leaflet has a newer Leaflet Link than the one on your 3DS, Cartridge Sync
offers **Update over Wi-Fi**. You confirm with **A** on the 3DS, the new version is written next to the old one and
checked before it replaces it, and Leaflet reconnects once you reopen Leaflet Link.

## Using it

1. Put your Wild World game card in the 3DS, then open Leaflet Link from the Homebrew Launcher.
2. In Leaflet, open **Cartridge Sync**. The first time, type the address the 3DS shows; after that Leaflet remembers
   it. The 3DS and your computer must be on the same Wi-Fi network.

From there you can:

- **Open in Leaflet**: edit the town that's on the card.
- **Save for an emulator**: get a `.sav` for melonDS, DeSmuME or any emulator that takes raw saves.
- **Send to the game card**: put back the town that's open in Leaflet, or any `.sav` (an emulator's, say).
- **Check the card**: the health check below.

## On the 3DS alone

Leaflet Link's own menu works without a computer, and without Wi-Fi:

- **X: Back up.** Reads the game card's save (each 4 KB until two reads agree) and writes it to
  `/3ds/LeafletLink/backups/<date> ADME backup.sav`, then reads the file back. A blank card has nothing to back up; a
  save that fails its checksums is still kept exactly as it is, with a warning.
- **Y: Saves.** Lists every Wild World save on the SD card, newest first: Leaflet Link's backups, and the save files of
  TWiLight Menu++ and nds-bootstrap forwarders. Pick one and press **A** to put it on the game card. It goes through
  every check a save from Leaflet does (CRC, both copies of the town, the letters, the chip, the battery, the region),
  shows the town's name, and waits for **A** again. The card's current save is kept first as
  `<date> ADME before restoring.sav`. A damaged save is listed in red and can't be chosen.
- **R: Check.** The health check: it reads the whole save chip six times, compares every byte of every read with the
  first, and asks the chip for its ID each time. Then it checks the town's checksums. A healthy card reads the same
  every time; a dusty contact flips a bit now and then, which shows up as areas that changed between reads. It never
  writes, and **B** stops it. Leaflet's **Check the card** runs the same check and shows the details.

## TWiLight Menu++ and forwarder saves

TWiLight Menu++ and nds-bootstrap keep a DS game's save beside it on the SD card, usually in a `saves` folder next to
the `.nds` (`/roms/nds/saves/…sav`), sometimes in the same folder, with `.sav1` to `.sav9` for extra slots. Leaflet
Link looks through the SD card a few folders deep for them (skipping `Nintendo 3DS`, `3ds`, `luma` and the like), and
reads only two bytes of each `.sav` first, so other games' saves cost almost nothing. Anything that looks like a Wild
World save is read in full and checked.

From Leaflet, each one can be opened, put on the game card, or replaced with the town that's open in Leaflet. Replacing
one is guarded like a card write: the CRC and every checksum are checked, the region must match, and the 3DS waits for
**A**. Then the old file is copied to the backups folder (`… before Leaflet.sav`) and read back, the new save is
written beside the old one (`.leaflet-new`) and read back, and only then is it swapped in and checked again. If the
swap doesn't check out, the old file goes back. A file padded past 256 KB keeps its padding. Leaflet Link's own
backups are never written over.

## The Town Diary

Each time Leaflet reads the game card, that version goes into Backups (an unchanged card adds nothing). On connecting,
Leaflet also brings in the versions on the 3DS's SD card that it hasn't seen: Leaflet Link's backups and TWiLight Menu++
saves, each with the time it was made on the 3DS (adjusted for any difference between the 3DS's clock and the
computer's). The Town Diary compares each version with the one before, so what was played on the real console shows
up there too.

## Playing on melonDS (Mac and Windows)

**Play on melonDS** on the Cartridge Sync page runs a whole round trip (`mac/EmulatorSession.swift` on a Mac,
`windows/Leaflet Helper.ps1` on Windows):

1. **Setup, once.** Choose the ROM backup you made from your own game card. If melonDS isn't installed, **Install
   melonDS** fetches the latest macOS build from melonDS's GitHub releases (`mac/MelonInstaller.swift`). The download
   must match the SHA-256 GitHub publishes for it, and the app's code signature must pass a strict check, or nothing
   is installed. It goes into `~/Applications` (an older copy goes to the Trash). It's marked as downloaded, so macOS
   still checks it the first time it opens; melonDS isn't notarized, so that means one Open Anyway in Privacy &
   Security, which Leaflet points you to. The
   ROM must be the same version as the game card (`ADME`, `ADMP`, …), or the game couldn't read the save.
2. **Start.** Leaflet reads the game card and keeps that save in Backups. It writes the town into Leaflet's play
   folder (`~/Library/Application Support/Leaflet/Play`, outside iCloud, so the ROM copy is never uploaded) and reads
   it back. It gives melonDS the town's Nintendo WFC ID, then starts melonDS with the game. A save already in the play
   folder is moved to `Earlier saves`, never overwritten.
3. **While you play.** Each time melonDS writes the save, that version goes into Backups.
4. **Back.** When melonDS quits, Cartridge Sync lists what changed. **Send it to the game card** opens the usual
   review, then A on the 3DS, then a byte-by-byte check. If the card changed since you started (say you played on
   the 3DS too), sending is blocked until you confirm. **Keep playing** reopens melonDS where you left off.
   **Set aside** keeps everything in Backups.

The session is saved to disk (`session.json` and `start.sav`), so if Leaflet is closed while you play, it offers to
send the town back the next time it opens.

**On Windows**, Leaflet is a page in an Edge (or Chrome) app window, so **Start Leaflet** also starts Leaflet Helper,
a PowerShell script beside it that does what the Mac app does natively: the play folder is
`%LOCALAPPDATA%\Leaflet\Play` (never OneDrive), **Install melonDS** puts the latest Windows build, checked against
GitHub's SHA-256, in `%LOCALAPPDATA%\Programs\melonDS` with no administrator needed (an update keeps
`melonDS.toml` and `wfcsettings.bin`, which melonDS keeps next to `melonDS.exe`), and it finds saves on removable
drives and installs Leaflet Link over Wi-Fi. It listens on `127.0.0.1` only, answers only the Leaflet window it opened
(a random token in that window's address, its own host name, and no other website's origin), and closes itself a
minute after the window is gone. Leaflet keeps its `file://` address, so existing backups stay where they were.

Leaflet Link can't send the ROM itself. Apps started from the Homebrew Launcher can only reach a DS game card's
save chip; reading the game takes lower-level access than a homebrew app has. Use a backup you made yourself.

## Keeping the town's clock (and turnips)

The game's time is the system clock plus `ClockOffset` in the save (`0x15FB4`: minutes and seconds). From the
decompilation, turnips spoil when the game's time goes backwards (`Town_IsClockBeforeLastUpdate`), when a day change
lands in a new week or seven or more days pass (`Town_ApplyElapsedDays`), or after the game's own clock menu is used
(`TurnipMarket::spoilOnReset`). So two systems whose clocks differ make the town look time-travelled.

Leaflet keeps the town's time with the save (`js/gameclock.js`):

- Leaflet Link 1.2 reports the 3DS's clock in `/info`. Leaflet compares it with the computer's clock, and with
  melonDS's own `RTC.Offset` (from `melonDS.toml`).
- **To an emulator** (Play on melonDS, Save for an emulator), the save's offset moves by the 3DS clock minus the
  emulator's clock, so the game shows the same date and time there.
- **Back to the game card**, it moves the other way. For a save file, the review asks where it was last played: an
  emulator on this computer (shifted) or a DS or 3DS such as one with an R4 (left as it is).
- Only the offset changes, and under a minute of difference is left alone. Changing the offset doesn't set the
  game's "clock moved" flags; only its clock menu does.

## Saves on SD cards

Flashcarts such as the R4 keep each game's save next to it on the microSD card (the same name ending in `.sav`,
sometimes padded to 512 KB). **Look on SD cards** in the Mac app searches every inserted SD card and removable drive
a few folders deep (`mac/SaveFinder.swift`; Leaflet Helper on Windows). In a browser, choose the card's folder. Each town found can be opened,
backed up or sent to the game card. Japanese and Korean saves are listed but marked unsupported.

## Keeping your friend code

A friend code isn't stored on the console. The game makes it from a profile in the save, and only keeps using that
profile on a system whose Nintendo WFC user ID (43 bits in the firmware's Wi-Fi settings) matches the one the save
recorded. On any other system the game makes a new profile, which means a new friend code and no friends.

Cartridge Sync treats the save as the source of truth (`js/wfc.js`):

1. It reads each resident's DWC user data from the save (player `+0x1E10`, 64 bytes, CRC-32 checked): the
   authentic user ID and the profile ID. It shows the friend code, worked out the way the game does it (CRC-8 of the
   profile ID and game code).
2. It writes that user ID into melonDS's Wi-Fi settings: `wfcsettings.bin` for its built-in firmware, or a firmware
   dump. Only the 43 ID bits in access point slots 0 and 1 change, plus each slot's CRC-16. That's exactly where the
   game reads the ID: slot 0, or slot 1 if slot 0 is damaged.
3. Before handing the file over, it reads it back the way the game does and checks that it gets the save's ID, that
   every slot's checksum is valid, and that no other byte changed. A file with a damaged slot is refused, because the
   game would throw such a file away and make a new ID.

On a Mac, **Give melonDS this ID** updates `~/Library/Preferences/melonDS/wfcsettings.bin` directly; on Windows, the
one next to `melonDS.exe`. The old file is kept next to it, and nothing is written while melonDS is open. Elsewhere,
download the file or update your own.

Register for Wi-Fi on the system you'll play on most; that system's ID becomes the town's. Play online on one system
at a time.

## How a save is kept safe

Writing is guarded on both sides. Nothing is written unless every check passes.

**In Leaflet, before sending**

- The card is read again right before sending, and Leaflet shows what will change ("Juniper paid off the loan").
- A different town needs a ticked "Replace" box, and saves from a different region are refused.
- The card's current save is added to Backups.

**On the 3DS, before writing**

- The save must be exactly 256 KB and arrive with the CRC-32 Leaflet computed.
- It must pass every checksum the game checks: both copies of the town and the town hall letters.
- The card must still be Wild World, its save chip must be the 256 KB flash the game uses, the battery must not be
  low, and an existing save must be from the same region.
- The 3DS shows the town's name, and **nothing happens until you press A**. The HOME button and sleep are held off
  while it writes.

**Writing**

1. The card is read twice, each 4 KB chunk until two reads agree. That copy goes to
   `/3ds/LeafletLink/backups/` on the SD card and is read back before anything is written.
2. Only the 256-byte pages that differ are written, lowest address first, and each one is read back. Going lowest
   first means the game's first copy of the town is complete before its second copy changes. If the power goes out
   part way through, the game still finds one healthy copy.
3. The whole card is read back and compared byte for byte. Pages that don't match are written again, at most twice.
4. If a page won't stick, the original save is written back and checked the same way. The 3DS and Leaflet then say
   so: "Your save is safe".
5. Leaflet reads the card back over Wi-Fi and compares it with what it sent. The sent save goes into Backups too.

The write method (page write, or page erase plus program) is worked out on the first page. A page that fails after
that is treated as a fault, never as a reason to fall back to erasing a whole 64 KB sector.

## Building

You need [devkitPro](https://devkitpro.org/wiki/Getting_Started) with the `3ds-dev` group (devkitARM, libctru,
citro2d). Then run:

```bash
make -C link
```

This builds `link/LeafletLink.3dsx` and bundles it into `js/linkapp.js` (with `tools/build_link_js.py`), so Leaflet can
install and update it. A path with spaces in it works too: the Makefile builds in a temporary copy. The
[Leaflet Link workflow](../.github/workflows/leaflet-link.yml) builds it on
GitHub too, with devkitPro's official image.

## Testing without a 3DS

`link/source/core.c` holds everything that isn't 3DS-specific: the checks, the save-chip commands, the write engine
and the HTTP server. `link/host/sim.c` runs that same core on a computer, with a simulated game card whose flash chip
behaves like the real one (write-enable latch, busy flag, page write and erase semantics). It can also fail on
purpose:

| Option | Simulates |
|---|---|
| `--chip plain` | a chip that only takes erase + program |
| `--chip eeprom` | the wrong kind of save chip |
| `--flaky-reads N` | a dirty contact that flips a bit every Nth read |
| `--stuck-page ADDR` | a worn-out page that never changes |
| `--deaf-pages N` | writes that are ignored the first time |
| `--pull-at N` | the card taken out mid-write |
| `--low-battery` | a battery too low to start |
| `--answer yes/no/delay/ask` | what the person presses on the 3DS |
| `--sd DIR` | the SD card (a folder) |
| `--console` | the console's own menu, typed on stdin: `backup`, `health`, `scan`, `restore N`, `stop` |

To build the simulator and run the end-to-end tests (75 checks, including updates, the console's menu, SD card saves
and the health check), use:

```bash
make -C link sim && python3 link/tests/test_link.py link/host/leaflet-link-sim
```

The tests make a synthetic save, so no game data is needed. Pass a real `.sav` as a second argument to test with it.
To try Leaflet against the simulator, run `link/host/leaflet-link-sim --card some-copy.sav --answer delay`. Then
connect Cartridge Sync to `127.0.0.1`.

## Protocol

This is plain HTTP on port 8226, with CORS open so Leaflet can call it from a page or app.

**Finding it (1.3.1).** Leaflet Link also listens on UDP port 8226. A `leaflet-link?` datagram (the Mac app and Leaflet
Helper broadcast one) gets the answer `leaflet-link <version> <card code>` (`-` with no card), so Cartridge Sync finds
the 3DS without its address being typed, and finds it again when the router gives it a new one. Since 1.3.2 the socket is opened again every few seconds until it works (for example while Wi-Fi is still
connecting), `/info` says `"discovery": true` or `false`, and the top screen adds "(Find my 3DS off)" when it isn't
listening.

**Save chips (1.3.2).** Most flash chips give their size in the third byte of their ID. The Sanyo LE25FW203T in some
Wild World cards answers `62 16 00`, so Leaflet Link knows it from a small table (256 KB). Writing tries page write,
then page erase and program, then sector erase and program, and reads every page back, so a chip that doesn't take one
method is still written correctly, and the original is put back if a page can't be.

| Request | Answer |
|---|---|
| `GET /` | Leaflet itself, one gzipped page, for phones and tablets (2.0) |
| `GET /info` | app version, protocol, `features` (1.3: `sd`, `health`; 2.0: `web`, `sdfull`, `backup`), the 3DS's clock, card (`present`, `code`, `ready`, `writable`, `why`), battery |
| `GET /save` | the card's 256 KB save, with its CRC-32 in `X-Leaflet-CRC32` |
| `POST /save?crc=&town=&residents=&job=` | a 256 KB save to write; checked, then waits for A on the 3DS |
| `GET /status` | `state` (idle, confirm, backup, writing, verifying, restoring, done, failed, updating, checking), `kind` (card, update, sdfile, backup, health), progress, message, backup path, and for a health check `health` (passes, unstable areas, flipped bits, checksums) |
| `POST /cancel` | sets aside a save that hasn't been confirmed, or stops a health check |
| `POST /health` | starts the health check (1.3) |
| `GET /sd[?fresh=1][&full=1]` | 2.0 looks only in the folders where it found saves before (`/3ds/LeafletLink/folders.txt`, answered with `quick`: true) unless they're empty or `full=1`. Starts looking through the SD card (unless a search just finished) and answers at once with `scanning` and what's been found so far; ask again while `scanning` is true (1.3.1). Wild World saves on the SD card: path, town, residents, size, when it was saved (3DS clock), region, `ok`, `kind` (backup or game) (1.3) |
| `GET /sd/file?path=` | the first 256 KB of a listed save, with its CRC-32 (1.3) |
| `POST /sd/file?path=&crc=&town=&residents=&job=` | a 256 KB save for a listed game save file; checked, then waits for A on the 3DS (1.3) |
| `POST /backup?crc=` | a 256 KB save from Leaflet on a phone, kept in the backups folder if it's healthy; never written to the card (2.0) |
| `POST /update?crc=&version=&job=` | a new `LeafletLink.3dsx`; checked (CRC, 3DSX header), then waits for A on the 3DS |

`link/tests/mock_hbl.py` stands in for the Homebrew Launcher's receiver, to test the wireless installers. It was
checked against devkitPro's own `3dslink`.

## Legal

Leaflet Link reads and writes only the **save** on a game card you own. It doesn't read, copy or change the game
itself, and contains no Nintendo code or content. It uses libctru, citro2d and citro3d (zlib license). Running
homebrew requires modifying your console; that's your choice, and it may void your warranty. See
[LEGAL.md](../LEGAL.md).
