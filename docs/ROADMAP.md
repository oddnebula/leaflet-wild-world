# Leaflet: ideas for true Wild World fans

A brainstorm of features beyond "edit every byte". Rough effort: S (an afternoon), M (a few days), L (a week or more).
★ marks the ones that seem most loved for the effort. ✅ marks what's built.

## Next up, in order of impact (October 2026)

Worked through in chunks, highest impact first. Each chunk ships as its own release.

**Chunk 1: bugs and the 3DS found automatically**
- [x] The Mac app on Intel Macs: checked under Rosetta; it starts and runs (the build warning is harmless).
- [x] Leaflet Link keeps drawing while it looks through a large SD card.
- [x] The Town Diary brings in the 3DS's whole backlog, not 24 versions per connection.
- [x] Review Leaflet Helper (Windows) for PowerShell 5.1 quirks (JSON, file dialogs).
- [x] Find the 3DS automatically, so nobody types its address.
- [ ] Leaflet Link 1.3 on a real 3DS (needs the person's console).

**Chunk 2: completionists**
- [x] Happy Room Academy calculator: each room scored from the confirmed rules, with what would raise it. Feng Shui is still to research, so it shows as an estimate.
- [x] Turnip advisor: the game rolls the week's prices in advance, so it says exactly whether to sell now or wait.
- [x] One "100% town" score at the top of Completion.
- [~] Gyroid collection: counted on Completion and in the catalog. Their sounds need the gyroid sound IDs, still to research.
- [-] Emotion and hairstyle checklists: dropped. The game keeps only each resident's current four emotions and current style, so there's nothing to tick off.
- [x] K.K. jukebox: learned and missing songs, play all, shuffle, stereo or live.
- [x] Neighbor relationship web on Friendships.
- [ ] Move-out predictor: needs the game's move-out rules from the decompilation first.

**Chunk 3: fans**
- [x] Villager trading: export a neighbor to a .wwvillager file and import one into a neighbor's house (marked Likely: the game's own move may update a little more).
- [x] Letter studio: a Game view draws each letter on its stationery in the game's own font (font/fontA, read from the ROM).
- [x] Town tune book: public-domain melodies only (no game or film themes).
- [x] Sound Room: all 342 music tracks and every sound effect by number, and neighbors saying their catchphrase in Animalese. Each villager's own voice pitch is still to research.
- [ ] The town tune with the game's real instrument: needs MelodyPlayer from the decompilation.
- [x] Constellation share codes and pictures on Celeste's Sky. A library of famous shapes is still to draw.

**Chunk 4: more 3D (from your own ROM)**
- [x] Your resident in 3D: outfit, hair, tan, held tool (already on each resident's page).
- [x] Neighbors' houses in 3D: their room layout from the ROM, with the game's own furniture, wallpaper and flooring.
- [x] A night sky you can turn, with every constellation in town (Celeste's Sky).
- [ ] Main Street in 3D: Nook's with this week's stock, the Able Sisters, the museum.
- [x] Walk around the whole town in 3D, or see it from above: every map item exactly placed, the ground shaped from each acre's type (drawn by Leaflet).

**Patterns**
- [x] Wendell's corner on the Pattern Library: his 32 designs by name (read from your ROM), with the ones already in your towns ready to copy into any slot.
- [x] Leaflet's pattern pack: 32 original designs, free to use.
- [ ] Wendell's designs' pictures straight from the ROM: their pixels aren't stored plainly in the ROM (only their names are, in myOrg/myD.bin), so they still have to be found.

**Chunk 5: polish**
- [x] Compare any two backups: the diary's story of what changed, and which parts of the save differ (Backups page).
- [x] Undo and redo across every page (⌘Z, ⇧⌘Z), for the session.
- [ ] Japanese and Korean saves: every offset and the character set differ, so this needs a Japanese save and decompilation to map against first.

## Living with your town
- ✅ **Town diary (S–M).** Every backup is already a snapshot. Diff consecutive ones into a readable journal:
  "Oct 19: Bob moved in. Donated a coelacanth. Paid 98,000 bells on the loan. Limberg started gardening." A timeline
  view with filters per resident.
- ✅ **Today in your town (M).** A dashboard card for the save's own date and clock offset: weather by the hour, who's
  visiting (the decoded event schedule), Joan's price, birthdays this week, what's catchable right now, which
  neighbors are outside, the shop sale hour. A "should I play now?" page.
- ✅ **Upcoming events calendar (M).** Resolve every `sEventSchedule` rule for any year: Fishing Tourney, Bug-Off,
  Flower Fest, Acorn Festival, Bright Nights, birthdays, Joan, K.K. Saturdays, with times. Export to .ics so the
  events show up in the player's real calendar.
- **Turnip advisor (S).** The four price patterns are known; show the likely pattern from the prices so far, the
  odds, and a "sell / wait" hint. Optional notification at noon on the Mac.
- **Neighbor relationship web (S).** The 28 pair scores and each villager's friendship with each resident drawn as a
  graph, plus "who's likely to move next" from the plan states and friendship.
- **Move-out predictor (M).** Plans (state 9/11), friendship, last move-out time and species history: estimate who
  will ask to leave and when, with a way to keep a favorite neighbor.

## Collecting and completion
- ✅ **Real catalog browser (M).** All 3,000+ items with ROM icons, class A/B/C, series, theme, Feng Shui color,
  price, where it comes from (Nook, Redd, Able, gifts, events, letters) and whether each resident has it. Filters
  like "missing from my catalog" and "only from Redd". (Built without the where-it-comes-from sources, which aren't in the
  game's tables.)
- ✅ **Series and set tracker (S–M).** Furniture sets (Classic, Modern, Ranch, Gorgeous, Golden...), with what's
  owned in house, dressers and catalog, and the bonus HRA points a full set gives.
- **Happy Room Academy calculator (M).** Score each room the way the game does (base points, Feng Shui, sets,
  themes, clutter) using `sFtrClassBasePoints` and the room layouts; suggest swaps that raise the score.
- **Gyroid collection (S).** All gyroids with their sounds played from the SDAT, which ones you own, and where they
  sit (the gyroid beat table we already decode).
- ✅ **Fossil assessor (S).** Unassessed fossils in pockets and dressers, which ones the museum still needs,
  one-click assess.
- **Emotion and hairstyle checklists (S).** All 60 emotions and every Harriet style, with how to unlock each.
- **K.K. jukebox (S).** All 70 songs with a playlist, shuffle and "which ones am I missing".

## Creativity
- ✅ **Pattern studio upgrades (M).** Layers, mirror drawing, a palette swapper, a library of every pattern in every
  save you've opened (backups make this free), and preview of a design on a shirt, umbrella, hat and flag in 3D.
- **Town planner (L).** Drag trees, flowers and paths over the real map art from the ROM, with flower-breeding odds,
  perfect-town scoring per acre, and "apply to save" when happy.
- ✅ **Room designer in 3D (L).** Render the house rooms with the real furniture models (`ftr/` NSBMD) and walls, so
  the room editor looks exactly like the game; take screenshots.
- **Constellation gallery (S).** Export a constellation as an image, share codes, and a library of famous shapes.
- **Letter studio (S).** Write letters on the real stationery with the game's font (from `font/`), preview them
  exactly, and import/export letters as images.
- **Town tune book (S).** A library of famous melodies (Zelda, Mario, Pokémon) for the tune composer, with the
  game's melody instrument once MelodyPlayer is ported.

## Sound and atmosphere
- ✅ **Hourly music player (M).** The game's 24 hourly themes (and rain/snow variants) from the SDAT, synced to the
  real clock or the save's clock, as a background ambience.
- **Villager voices (S).** Hear each villager say their catchphrase in their own voice pitch.
- **Sound test (S).** Browse every SSAR effect and SSEQ track by number, with names where known.

## Sharing and multiplayer
- ✅ **Town card (S).** A shareable image of the town: map, fruit, tune, residents, neighbors, flag, house.
- ✅ **Cartridge Sync (L).** Leaflet Link, a 3DS homebrew app, reads and writes the game card's save over Wi-Fi,
  with backups, CRC and checksum checks, confirmation on the console, read-back verification and automatic restore
  (link/). Next: test on real hardware with several cartridges (different flash chips), and add discovery so the
  address doesn't have to be typed.
- ✅ **Wireless install and updates of Leaflet Link, friend codes kept on emulators, and Play on melonDS** with
  sessions that survive restarts and send the town back to the card.
- ✅ **Console tools (Leaflet Link 1.3).** Back up and restore on the 3DS alone, a read-only health check of the save
  chip, TWiLight Menu++ and forwarder saves on the 3DS's SD card, the Town Diary fed by real play, and Play on melonDS
  for Windows through Leaflet Helper. Next: find the 3DS automatically, a pairing PIN, and DeSmuME.
- **Villager trading (M).** Export a neighbor (the 0x700-byte record) as a file and import into another save,
  the way the game moves villagers between towns.
- **Item gifting between saves (S).** Copy items or patterns from one save to another with drag and drop.
- **Wi-Fi era tools (M).** Inspect friend codes in the roster, and prepare saves for the community Wi-Fi
  replacement servers.

## Safety and tooling
- **Backup timeline compare (S).** Pick two backups and see exactly what changed, grouped by feature.
- ✅ **Integrity doctor (M).** Find and fix impossible states: items in walls, duplicate villagers, buried items on
  water, broken letters, an occupied plot with no villager. Explain each issue in plain words.
- **Undo history (M).** Every edit as a step you can undo, across views, saved with the draft backups.
- **Mods and AR codes (M).** Convert edits into Action Replay codes for players on real hardware without a save
  dumper, and import the community's AR codes as edits.
- **Region support (M).** EU, JP and KR saves and ROMs (different offsets and charsets).

## Research
- ✅ **Map the last 28 bytes (S–M).** Done: the bulletin board's last-posted date, the notices-started flag and the online event; the rest is padding the game never reads.
- ✅ **Calendar keys (S).** Town event start/end are event-date words (hour, day, month), edited as dates.
- **Melody player (M).** Port `MelodyPlayer` so the town tune plays with the game's own instrument.
