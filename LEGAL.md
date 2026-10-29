# Legal notice

**Please read this before using Leaflet with a ROM.** This notice is information, not legal advice.

## Not affiliated with Nintendo

Leaflet is an independent, non-commercial fan project. It is **not affiliated with, endorsed by, sponsored by or
approved by Nintendo** or any of its partners. *Animal Crossing*, *Animal Crossing: Wild World*, *Nintendo* and
*Nintendo DS* are trademarks of Nintendo. They are used here only to say which game's save files Leaflet works with.
Leaflet uses no Nintendo logos.

## Use only a ROM you dumped from a cartridge you own

Leaflet edits **save files**. It works fully without any ROM. Opening a ROM is optional, and only adds the game's own
art and sound to the interface.

If you choose to open a ROM:

- **It must be a backup you made yourself from an *Animal Crossing: Wild World* cartridge that you legally own.**
  Use your own hardware and a dumping tool to make it.
- **Do not download ROMs from the internet.** Getting a copy of a game you don't own is copyright infringement in
  most countries, whatever the website says.
- Whether making a personal backup is allowed at all depends on where you live. Some places allow it and others
  don't. **You are responsible for following the law in your country.**
- Keep your backup to yourself. Don't share, upload or distribute it.

## What this project does and doesn't do

- **No ROMs and no game content.** This repository and its releases contain no ROM, no save files and nothing
  extracted from the game: no artwork, icons, textures, models, music, sound effects, fonts, scripts or message text.
  `.gitignore` blocks ROM, save and sound-archive files from ever being committed.
- **No links and no help getting ROMs.** The project doesn't link to, recommend or help find ROM downloads.
  Issues, pull requests or messages asking for ROMs or game files will be closed without a reply.
- **No copy protection is bypassed.** Leaflet reads a file you give it, in your browser or app. It doesn't decrypt,
  patch or get around any technical protection measure, and it doesn't modify or redistribute the game.
- **Everything stays on your computer.** Anything Leaflet reads from your ROM is kept only in Leaflet's local browser
  storage on your machine. It is never uploaded, and *Forget game art* on the Welcome screen deletes it.
- **Only factual data is shipped.** Leaflet includes save offsets and structures, item and villager names and ids,
  palette values, spawn odds and number tables documented by the community, the same kind of data other open-source
  save editors publish. Sources and licenses are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- **Your own saves only.** Leaflet is meant for editing saves of games you own, for personal use.

## Designs

Leaflet's pattern pack is original work, drawn for Leaflet; it copies no design from the game, its guide books or other players. Wendell's designs are listed by name from your own ROM, and only the ones already in your own saves can be copied into a slot. Leaflet doesn't include or download any of them.

## Leaflet Link (Cartridge Sync)

Leaflet Link is an optional 3DS app that lets Leaflet read and write the **save** on your Wild World game card over
your own Wi-Fi network.

- It only touches the save chip of a game card you put in the console. It doesn't read, copy, dump or change the game
  itself, and it can't be used to copy games.
- It contains no Nintendo code, logos or content. It's built with the open-source libctru, citro2d and citro3d
  libraries (zlib license).
- It runs as homebrew, so it needs a console set up to run homebrew. Setting that up modifies your console, may void
  its warranty, and its legal status depends on where you live. **That choice, and following your local law, are
  yours.** Leaflet Link itself doesn't bypass or disable any protection, and this project doesn't explain how to set
  up homebrew or link to tools that do.
- It talks only to Leaflet on your local network. Nothing is sent to the internet.
- **Play on melonDS** uses a ROM backup that you choose, which must be one you made from your own game card. Leaflet
  keeps a copy of it only in its own play folder on your computer (`~/Library/Application Support/Leaflet/Play` on a
  Mac, which isn't synced to iCloud; `%LOCALAPPDATA%\Leaflet\Play` on Windows, which isn't synced to OneDrive) so the
  emulator can keep its save next to it. Leaflet never uploads, shares or downloads ROMs, and Leaflet Link can't read
  or copy the game from a game card.
- Leaflet Link also lists save files already on your 3DS's SD card, such as those TWiLight Menu++ makes, and reads or
  writes only those **saves**. It never reads, lists or copies the games (`.nds` files) themselves.
- Keeping a friend code on an emulator copies your town's own Nintendo WFC ID (from your save) into your emulator's
  settings. Nintendo Wi-Fi Connection closed in 2014; replacement services such as Wiimmfi are run by others, have
  their own rules, and aren't connected to this project.

## No warranty

Leaflet is provided "as is" under the [MIT License](LICENSE), without warranty of any kind. Always keep a backup
of your save before you play an edited file, and before sending a save to a game card for the first time.

## Rights holders

If you represent a rights holder and believe something in this repository infringes your rights, please
[open an issue](https://github.com/oddnebula/leaflet-wild-world/issues) or contact the maintainer through GitHub.
Tell us what the material is and where it is, and it will be reviewed and, if appropriate, removed promptly.
