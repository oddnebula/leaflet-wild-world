# Third-party notices and credits

Leaflet is an independent fan project. It is **not affiliated with, endorsed by or sponsored by Nintendo**.
*Animal Crossing*, *Animal Crossing: Wild World* and *Nintendo DS* are trademarks of Nintendo.

## No Nintendo content in this repository

This repository and its releases contain no ROM, no save files and nothing extracted from the game: no artwork,
icons, textures, 3D models, music, sound effects, voice samples, fonts, scripts or message text. `.gitignore` keeps
`.nds`, `.sav`, `.dsv` and `.sdat` files out. When a player opens **their own** ROM, Leaflet reads the art, sound
and furniture tables it needs at runtime and keeps them only in that computer's browser storage.

What the repository does include is factual reference data, of the kind other open-source save editors publish:
save offsets and structure, item, villager, acre, song and emotion names and ids, palette color values, bug and fish
spawn odds, and numeric tables documented by the decompilation (hourly weather patterns, the event schedule rules,
villager birthdays, the star-map line cells, pocket-icon palette slots and Happy Room Academy class points). All
artwork in the interface (icons, acre thumbnails, backgrounds) is original SVG, CSS and drawing code.

Players must use a ROM backup they dumped from a cartridge they own. See [LEGAL.md](LEGAL.md).

## Code

| Project | Used for | License |
|---|---|---|
| [jsQR](https://github.com/cozmo/jsQR) by Cosmo Wolfe | Reading New Leaf / Happy Home Designer QR codes (`js/lib/jsQR.js`, unmodified) | Apache-2.0, see `licenses/jsQR-Apache-2.0.txt` |
| [Nunito](https://fonts.google.com/specimen/Nunito) by Vernon Adams | Interface font, loaded from Google Fonts (not bundled) | SIL Open Font License 1.1 |
| [libctru](https://github.com/devkitPro/libctru) by smea, fincs, WinterMute and contributors | Leaflet Link: 3DS system services (game card slot, SPI, sockets, battery) | zlib, see `licenses/libctru-zlib.txt` |
| [citro2d](https://github.com/devkitPro/citro2d) and [citro3d](https://github.com/devkitPro/citro3d) by fincs | Leaflet Link: drawing its screens | zlib, see `licenses/citro2d-zlib.txt` and `licenses/citro3d-zlib.txt` |

## Research and data

| Project | Used for | License |
|---|---|---|
| [ACSE](https://github.com/Cuyler36/ACSE) by Cuyler36 | Item, villager and acre id/name lists, the character table, Wild World and New Leaf palettes | MIT, see `licenses/ACSE-MIT.txt` |
| [WildStorage](https://github.com/NovaSquirrel/WildStorage) by NovaSquirrel | Emotion list and save research | MIT, see `licenses/WildStorage-MIT.txt` |
| acww-decomp by Lucina and the acww-decomp contributors | Save layout (`SaveData` and its structs), checksums, and the numeric tables listed above | MIT, see `licenses/acww-decomp-MIT.txt` |
| [LeafEdit-Core](https://github.com/Universal-Team/LeafEdit-Core) by Universal-Team | Short name lists: hairstyles, face types, hair colors, personalities, villager species | GPL-3.0 (lists used as factual labels; see the project for its license) |
| WildEdit, LeafEdit and ACWW_Research by Universal-Team and SuperSaiyajinStackZ | Save offsets and research notes | See each project |
| [3dslink](https://github.com/devkitPro/3dslink) and [3ds-hbmenu](https://github.com/devkitPro/3ds-hbmenu) by devkitPro | Leaflet Link's wireless install: the Homebrew Launcher's network-install protocol, reimplemented in `mac/LinkInstaller.swift` and `windows/Install Leaflet Link.ps1` | Protocol reference; no code used |
| [Sonic Rush Adventure decompilation](https://github.com/RushRE/SonicRushAdventure-Decomp) by RushRE | Friend codes: the Nintendo WFC library's user data layout, friend-code check digits and how the console's WFC ID is read and checked (`js/wfc.js`) | Research reference; no code used |
| [melonDS](https://github.com/melonDS-emu/melonDS) by Arisotura and contributors | The layout of melonDS's `wfcsettings.bin` and its default access points (`js/wfc.js`). Not bundled: the Mac app's **Install melonDS** downloads the official release from melonDS's GitHub when asked | Format reference; no code used (melonDS is GPL-3.0) |
| [GBATEK](https://problemkaputt.de/gbatek.htm) by Martin Korth | Leaflet Link: the DS game card save-chip (SPI flash) commands | Documentation, credited here; no code used |
| DrewPag's Wild World spawn-table research | Bug and fish availability by half-month and hour, with spawn odds (`tools/critters_src.json`) | Published research spreadsheet, credited here |

Thank you to everyone who has documented Wild World over the years.
