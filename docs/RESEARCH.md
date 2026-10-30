# ACWW save editor: research notes (USA ADME Rev 1)

ROM SHA-1 matches decomp target (77fde3e3...). Save: 256 KB, US, ID byte 0x8A.
Working copy of the user's save: `work/original.sav` (the original on the Desktop is untouched).

## Container
- Two copies of the main block, 0x15FE0 bytes each: copy A at 0x0, copy B at 0x15FE0.
- Main checksum: u16 at 0x15FDC so that the u16 little-endian sum of the block is 0 (per copy).
- **Pick the copy with the higher counter at 0x15F6C (u8, likely).** In this save B=0x0D, A=0x0C. Write: edit, fix checksum, copy to both.
- Letter storage: 0x2E20C, 0x11DF4 bytes, checksum u16 at 0x3FFFE (sum to 0). 4 players x 75 letters x 0xF4.
- 0x2BFC0-0x2E20C: all zero here.

## Town (absolute offsets in the main block)
| Off | What |
|---|---|
| 0x2 / 0x4 | Town ID u16 / name (8 WWChar) |
| 0xC + p*0x228C | Players 0-3 |
| 0x8A3C + v*0x700 | Villagers 0-7 (id 0xFF = empty) |
| 0xC330 | 36 acres (6x6 grid) |
| 0xC354 | 4096 map items u16 (16 acres x 16x16; acre-major) |
| 0xE354 | buried bits (0x200) |
| 0xE554 | grass type (this save has 0x22; the docs say 0-2. Check in decomp) |
| 0xE558 | House: 5 rooms x 0x450 (layer1 0x0, layer2 0x200, **wall 0x448, floor 0x44A**, song 0x44C) |
| 0xFAE8 | House debt u32 |
| 0xFAEC | Song library bits (9 bytes, FF x8 + 3F = all) |
| 0xFAF8 | House size (&7, 0-6) |
| 0xFAFA | lights flag? (AR "lights" code) |
| 0xFAFC + i*0x228 | Able Sisters patterns x8 |
| 0x11438 | moving-in villager (from another town) |
| 0x15430 + p*0xB4 | Dressers, 90 u16 each |
| 0x15700 | Blanca pattern; 0x15930 town flag pattern |
| 0x15B58 | Town gate type (0-2) |
| 0x15D50 | Museum, 0x5F bytes, nibble = donor player 1-4 (fossils, fish 0x15D6A, insects 0x15D88, paintings 0x15DA5) |
| 0x15DB8 | Nook's shop u16 list (~37 slots, confirm) |
| 0x15EC0 / 0x15EDE | Lost & found x15 / recycle bin x15 |
| 0x15F56.. | Turnip prices? (daily bytes, confirm in decomp) |

## Player (relative to player base)
Patterns 0x0 (8 x 0x228; name 0x216, creator 0x20C, byte 0x226 = palette upper nibble, design-type lower);
pattern order 0x1140; letters 0x1148 (10 x 0xF4; attachment +0xF0); pockets 0x1B22 (15);
wallet 0x1B40; catalog/encyclopedia bits 0x1B48 (0x124, see ACSE bitmaps); future letter 0x1C6C;
friend code 0x1E2C; bank 0x21E4; emotions 0x21EC (4); **Resetti flag 0x21FC bit 2**;
Nook points? 0x2208; held/shirt/hat/face/bed 0x220A..0x2212; inventory bg 0x2214; last play 0x2216;
birthday day/month 0x2218/0x2219; acorns 0x2225; hair style (hi)/face (lo) 0x223C;
tan (bits 4-5)/hair color (lo 3) 0x223D; town ID/name 0x2276/0x2278; player ID/name 0x2280/0x2282; gender 0x228A.

## Villager (relative)
pattern 0x340, letter 0x568, furniture 0x6AC (10), personality 0x6CA, species ID 0x6CB,
catchphrase 0x6DE (10), house x,y 0x6E8, shirt 0x6EC, wallpaper idx 0x6EE, carpet idx 0x6EF,
0x6F2 (song?), umbrella 0x6F4.

## Sources
ACSE (Cuyler36), WildEdit / LeafEdit-Core / ACWW_Research / wiki (Universal-Team), WildStorage (NovaSquirrel),
almarsguides AR codes (v1.0 RAM save base 0x021D6DD0), user's local acww-decomp-matching.
Item / villager / acre name lists: ACSE Resources/WW_*.txt.

## Status (2026-10-24)
The full field-by-field layout lives in `acww-editor/js/schema.js` (shown in the Save Explorer) and the decoded
findings are summarized in the README's research notes. Every byte of the 0x15FE0-byte main block is mapped: the
last ones were the bulletin board's last-posted date (town state +0x68), the "notices started" flag (+0x22), the
online event (0x15E29) and padding the game never reads (villager plan +0x22, villager memory +0x3E and +0x56,
0x38EB in the villager block, 0x15F6E, save byte 1, and the received letter's bytes after its checksum).

Not done yet: the town tune with the game's melody instrument (MelodyPlayer plays one sequence per note from its own
archive), and which weeks Lyle visits (EventWeek_IsInLyleWeek) for the calendar.

## Outside the main block (2026-10-29)
The game's save code writes exactly three regions (`data_020d0794`: 0x0, 0x15FE0, 0x2E20C), so:
- **0x2BFC0–0x2E20C (0x224C bytes) is never written or read.** It stays zero on real cartridges.
- **Letter storage tail:** +0x11DC0–0x11DEF padding; **+0x11DF0 (0x3FFFC in the file) is its save-state byte**, set to 0x1C
  while playing and 2 on a proper save (func_0209d604 / func_0209d5f8), alongside 0x15FDE. On load, if this byte isn't 2 or
  the storage checksum is wrong, the game **erases all town hall letters** (func_0209d610, Unk_020e27d4::vfunc_00).
  +0x11DF1 padding; +0x11DF2 checksum.

## Event flags (2026-10-29)
Scanned every call to the flag functions in main and all overlays, including C++-mangled calls
(test/set/clear: func_02098044 / 0209801c / 02097ff4 for residents, func_0209e170 / e148 / e120 for the town).
- Resident 17–21: Pelly's savings letters at 1M, 10M, 100M, 500M and 999,999,999 bells (func_02097214).
- Resident 28–31: Nook Point member letters from the ATM; tiers `data_020d0994` = 300, 5,000, 10,000, 20,000 points.
- Resident 11: Harriet's first-visit talk; 12: Crazy Redd; 16: Dr. Shrunk's first lesson; 14: Happy Room Academy's first score.
- Resident 23–26: accident insurance (signed up, pitch heard, two pending claims cleared when the payout is mailed).
- Town 1, 2, 11: Happy Room Academy house models at 70,000 / 100,000 / 150,000 points (func_02059adc).
- **Never used by any code:** resident 52 and 58–63; town 10 and 21–31.
- Still only placed by overlay, not by meaning: resident 0, 5, 9, 10, 13, 15, 22, 27, 35, 49, 50, 57 and town 0, 5–9, 12,
  14, 16–20. Their dialogue text (in the ROM's message archives) is the way to name them.

## Town models (2026-10-29)
- Acre `n` is `bg/a{n>>4}/{n:04x}.arc`: NARC of an 8-byte header, the BMD0 ground and 384 bytes (a 16×16 tile-type table,
  then 128 bytes of nibbles). Ground models are pre-bent around a circle of radius 32 (one acre) centred 0.62 below the
  model origin: flat z = 32·atan2(z, y + 0.62), height = hypot(z, y + 0.62) − 32. Two model units per map spot.
- Ground textures: `/bg/ct%d/grd_set%d%c.nsbtx` with the grass pattern and `'a' +` the ground season, both from 0xE554.
- Buildings: `/str/arc/%d/str%d%c.arc` (+ `.nsbtx`, `_lt.nsbtx` night lights), n = building item & 0xFF, c = s/w; palette
  `house_pl` lives in `str/house_pl/house_pl_{s,w}.nsbtx`. Player house roof `/str/plHsTex/home%c%c.nsbtx`. Gate
  `str/chkp/obj_check{0x15B58}`.
- Neighbour houses: `/str/npcHs/%d/obj_house%d_%d%c.arc`; the model is the low 5 bits of byte +0x28 of the villager's
  0x4E-byte record at 0x020CC408 (USA main code, BLZ-compressed in the ROM), and bits 5–6 pick one of the four town
  house textures `/str/npcHsTex/%c/house_%c%d%c.nsbtx` from the style bytes at 0x1592C (v/5 → A–E, v%5).
- Trees: `fg/tree/{tree,cedar,palm}_mdl/{kind}_{baby,01–04,dead}{s,f,w}`; leaves take one of 22 palettes in
  `tree_pal/tree_set{A,B,C}` (per grass pattern). Flower colours from `fg/flower/{kind}/{kind}_palette.nsbtx`.
- Tree stages: func_0209cc98 maps (month, day) to 23 stages by the end dates in data_020d06a0 (Feb 3, 17, 24, Mar 31,
  Apr 3, 8, Jul 22, Sep 15, 30, Oct 4, 10, 16, 20, 25, 30, Nov 2, 9, 13, 19, 25, Dec 1, 10, 31). Per stage
  data_ov003_0222f810 picks the model variant (0 winter, 1 blossom, 2 summer; blossom for broadleaf trees on Apr 1–8),
  which is also the palette set (tree_set A/B/C); data_ov003_0222f758 gives the leaf palette number
  (19, 20, 21, 0, 1, …, 19) and 22 for the trunk; data_ov003_0222f6a0 the weeds' palette (grass00–09).
- After unbending, the acres still dip a little toward the south edge, up to 0.31 model units, identically in every
  acre; Leaflet adds that measured curve back.

## Perfect town and flowers (2026-10-29)
- Acre survey func_0204a1c0/func_02049e40, score func_0204a630: 100; trees (0x26–2A, 0x2F–5B, 0x5D–61, 0x66–6D,
  0xC8–CF) outside 12–15 cost 2 each; weeds (0x21–24 only) from the third cost 1 each; junk (unburied class 1–4 items
  except fruit, coconuts, shells, spoiled turnips and garbage) from the third cost 1 each; garbage 0x1320–22 costs 10;
  a Rafflesia 50; flowers (≤0x1D except 0x1B, watered 0x8A–A3 and 0xA5) from the third add 1 each.
  Bands (func_02049e1c): <75, <80, <95, <101, ≥101. Town rating (func_02049990): perfect when no acre is under 95 and
  at least 8 are 101+.
- Hybrids: func_020492fc reads data_020da300[kind][lo][hi] → weighted list of flower ids (extracted in js/views-garden.js).
