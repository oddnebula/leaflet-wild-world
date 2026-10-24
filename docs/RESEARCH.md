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
