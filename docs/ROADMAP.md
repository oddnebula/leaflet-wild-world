# Leaflet: ideas for true Wild World fans

A brainstorm of features beyond "edit every byte". Rough effort: S (an afternoon), M (a few days), L (a week or more).
★ marks the ones that seem most loved for the effort. ✅ marks what's built.

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
- **Town card (S).** A shareable image of the town: map, fruit, tune, residents, neighbors, flag, house.
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
