#!/usr/bin/env python3
"""Generate js/data.js from the public reference editors (research tables only: no game artwork or audio).

Usage: python3 -I tools/build_data.py <ref-dir>
<ref-dir> holds clones of Cuyler36/ACSE (MIT), Universal-Team/LeafEdit-Core,
NovaSquirrel/WildStorage (MIT) and the ACWW decompilation (acww-decomp). Only factual tables (names, ids, palettes) are taken.
"""
import json, os, re, sys

REF = sys.argv[1]
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'js')
ACSE = os.path.join(REF, 'ACSE')


def read(path):
    with open(path, encoding='utf-8-sig') as f:
        return f.read()


def id_list(path):
    """Parse '0xID, Name' lines, tracking the '//Category' header above each."""
    out, cat = [], ''
    for line in read(path).splitlines():
        line = line.strip()
        if line.startswith('//'):
            cat = line[2:].strip()
        elif line.startswith('0x'):
            k, v = line.split(',', 1)
            out.append((int(k, 16), v.strip(), cat))
    return out


# Character table (ACSE StringUtility.cs, MIT).
src = read(os.path.join(ACSE, 'ACSE.Core/Utilities/StringUtility.cs'))
block = re.search(r'WwCharacterDictionary = \{(.*?)\};', src, re.S).group(1)
CS_ESC = {'0': '\0', 'n': '\n', '"': '"', '\\': '\\'}
chars = [re.sub(r'\\(.)', lambda m: CS_ESC[m.group(1)], s)
         for s in re.findall(r'"((?:\\.|[^"\\])*)"', block)]
assert len(chars) == 256, len(chars)

items = id_list(os.path.join(ACSE, 'ACSE.WinForms/Resources/WW_Items_en.txt'))
acres = id_list(os.path.join(ACSE, 'ACSE.WinForms/Resources/WW_Acres_en.txt'))
species = {i: c for i, _, c in id_list(os.path.join(REF, 'LeafEdit-Core/strings/ww/en/villager.txt'))}
# LeafEdit's list misplaces a few section headers: Buck is a horse, Vesta/Baabara are sheep and 0x80-0x89 are squirrels.
species.update({0x4E: 'Horse', 0x7E: 'Sheep', 0x7F: 'Sheep', **{i: 'Squirrel' for i in range(0x80, 0x8A)}})
villagers = [{'id': i, 'name': n, 'species': species.get(i, '')}
             for i, n, _ in id_list(os.path.join(ACSE, 'ACSE.WinForms/Resources/WW_Villagers_en.txt'))]

pal_src = read(os.path.join(ACSE, 'ACSE.Core/Patterns/Pattern.cs'))
pal_block = re.search(r'WwPaletteData = \{(.*?)\n        \};', pal_src, re.S).group(1)
palettes = [['#' + h for h in re.findall(r'0xFF([0-9A-Fa-f]{6})', row)]
            for row in re.findall(r'\{([^{}]*)\}', pal_block)]
palettes = [p for p in palettes if len(p) == 15]
assert len(palettes) == 16, len(palettes)

songs_src = read(os.path.join(ACSE, 'ACSE.Core/BitFields/SongLibrary/SongLibrary.cs'))
songs_block = re.search(r'WildWorldSongLibraryNames = \{(.*?)\};', songs_src, re.S).group(1)
songs = [s for s in re.findall(r'"([^"]*)"', songs_block)]

ency_src = read(os.path.join(ACSE, 'ACSE.Core/BitFields/Encyclopedia/Encyclopedia.cs'))
ency_block = re.search(r'WildWorldEncyclopediaNames = \{(.*?)\};', ency_src, re.S).group(1)
encyclopedia = re.findall(r'"([^"]*)"', ency_block)

by_id = {i: n for i, n, _ in items}
insects = [by_id[i] for i in range(0x12B0, 0x12E8)]
fish = [by_id[i] for i in range(0x12E8, 0x1320)]
fossils = [by_id[i] for i in range(0x450C, 0x45DC, 4)]
paintings = [by_id[i] for i in range(0x3894, 0x38E4, 4)]
assert len(fossils) == 52 and len(paintings) == 20

emo_src = read(os.path.join(REF, 'WildStorage/source/playeredit.c'))
emo_block = re.search(r'emotions_options\[\] = \{(.*?)\};', emo_src, re.S).group(1)
emotions = [re.sub(r'^\s*\d+\s+', '', e).strip() for e in re.findall(r'"([^"]*)"', emo_block)]


nl_block = re.search(r'NlPaletteData = \{(.*?)\};', pal_src, re.S).group(1)
nl_palette = ['#' + h for h in re.findall(r'0xFF([0-9A-Fa-f]{6})', nl_block)]
assert len(nl_palette) == 256, len(nl_palette)

# Spawn tables parsed from the game by DrewPag (tools/critters_src.json, from his public spreadsheet).
# grid[halfMonth 0..23][hour 0..23] = % chance this critter is picked; compressed into runs [halfMonth, startHour, endHour, pct].
BUG_WHERE = {
    'Common Butterfly': 'Flying near flowers', 'Yellow Butterfly': 'Flying near flowers', 'Tiger Butterfly': 'Flying near flowers',
    'Peacock': 'Flying near flowers', 'Monarch': 'Flying near flowers', 'Emperor': 'Flying near flowers',
    'Agrias Butterfly': 'Flying near flowers', 'Birdwing': 'Flying near flowers', 'Moth': 'Flying near lit windows',
    'Oak Silk Moth': 'On trees', 'Honeybee': 'Flying near flowers', 'Bee': 'Shake trees (beehive)', 'Long Locust': 'On the ground',
    'Migratory Locust': 'On the ground', 'Mantis': 'On flowers', 'Orchid Mantis': 'On white flowers', 'Brown Cicada': 'On trees',
    'Robust Cicada': 'On trees', 'Walker Cicada': 'On trees', 'Evening Cicada': 'On trees', 'Lantern Fly': 'On trees',
    'Red Dragonfly': 'Flying', 'Darner Dragonfly': 'Flying near water', 'Banded Dragonfly': 'Flying near water',
    'Ant': 'On spoiled turnips or rotten fruit', 'Pondskater': 'On ponds', 'Snail': 'On rocks and bushes in the rain',
    'Cricket': 'On the ground', 'Bell Cricket': 'On the ground', 'Grasshopper': 'On the ground', 'Mole Cricket': 'Underground (listen, then dig)',
    'Walkingstick': 'On trees', 'Ladybug': 'On flowers', 'Fruit Beetle': 'On trees', 'Scarab Beetle': 'On trees',
    'Dung Beetle': 'Rolling snowballs', 'Goliath Beetle': 'On trees', 'Firefly': 'Flying near water', 'Jewel Beetle': 'On tree stumps',
    'Longhorn Beetle': 'On tree stumps', 'Saw Stag Beetle': 'On trees', 'Stag Beetle': 'On trees', 'Giant Beetle': 'On trees',
    'Rainbow Stag': 'On trees', 'Dynastid Beetle': 'On trees', 'Atlas Beetle': 'On trees', 'Elephant Beetle': 'On trees',
    'Hercules Beetle': 'On trees', 'Flea': 'On villagers', 'Pill Bug': 'Under rocks (hit them with a shovel)', 'Mosquito': 'Flying at night',
    'Fly': 'On trash', 'Cockroach': 'Under rocks, or in messy houses', 'Spider': 'Shake trees', 'Tarantula': 'On the ground at night',
    'Scorpion': 'On the ground at night',
}
FIXED_NAMES = {'Agrias Butterfily': 'Agrias Butterfly'}
src_c = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'critters_src.json')))
critters = {}
for kind, base in (('bugs', 0x12B0), ('fish', 0x12E8)):
    out = []
    for c in src_c[kind]:
        name = FIXED_NAMES.get(c['name'], c['name'])
        runs = []
        for hm, row in enumerate(c['grid']):
            h0 = 0
            while h0 < 24:
                if not row[h0]: h0 += 1; continue
                h1 = h0
                while h1 + 1 < 24 and row[h1 + 1] == row[h0]: h1 += 1
                runs.append([hm, h0, h1 + 1, row[h0]]); h0 = h1 + 1
        where = BUG_WHERE.get(name, '') if kind == 'bugs' else re.sub(r'\s+', ' ', c['loc']).replace(' ,', ',')
        out.append({'item': base + c['id'], 'name': name, 'where': where, 'runs': runs, 'special': not runs})
    critters[kind] = out


# Weather: 32 day patterns, each 24 hourly levels starting at 6 AM (0 clear .. 2 overcast, 3 rain/snow, 4 heavy),
# from the decompilation (sWeatherHourTable).
def c_array(path, name):
    m = re.search(name + r'\[\w+\]\s*=\s*\{(.*?)\};', read(path), re.S)
    return [int(x, 16) for x in re.findall(r'0x[0-9a-fA-F]+', m.group(1))]


wx = c_array(os.path.join(REF, 'acww-decomp/src/main/unk_020b8d9c.cpp'), 'sWeatherHourTable')
assert len(wx) == 768
weather = [''.join(str(v) for v in wx[i * 24:(i + 1) * 24]) for i in range(32)]

# Pocket icon palettes (sItemIconPalettes): palette slot per icon; the icon art itself is read from the player's ROM.
icon_pals = c_array(os.path.join(REF, 'acww-decomp/src/ov094/unk_ov094_02292da8.cpp'), 'sItemIconPalettes')
assert len(icon_pals) == 336

# Celeste's sky (sConstellationLineCells): 454 line segments, each up to 4 cells (x | y << 8 on a 64×32 grid,
# 0xFFFF ends a segment early). A saved constellation lists up to 16 of these segment numbers.
sky = c_array(os.path.join(REF, 'acww-decomp/src/main/unk_020b0774.cpp'), 'sConstellationLineCells')
assert len(sky) == 0x718
sky_lines = [[[v & 0xFF, v >> 8] for v in sky[i * 4:i * 4 + 4] if v != 0xFFFF] for i in range(len(sky) // 4)]


# Villager birthdays (sVillagerInfoTable, 0x4E bytes per species; month and day at +0x26, read by Villager_GetBirthday).
vinfo = c_array(os.path.join(REF, 'acww-decomp/src/main/unk_02077ac4.cpp'), 'sVillagerInfoTable')
assert len(vinfo) == 150 * 0x4E
for v in villagers:
    if v['id'] < 150:
        v['birthday'] = [vinfo[v['id'] * 0x4E + 0x26], vinfo[v['id'] * 0x4E + 0x27]]

# The event calendar (sEventSchedule): per event its id, category and start / end rules, each rule a date word, a
# day (or day offset) and an hour. Resolved for any date by js/calendar.js the way EventRule_Resolve does.
m = re.search(r'sEventSchedule\[99\] = \{(.*?)\n\};', read(os.path.join(REF, 'acww-decomp/src/main/unk_0203f104.cpp')), re.S)
num = lambda x: int(x, 16) if x.lstrip('-').startswith('0x') and not x.startswith('-') else int(x, 0)
schedule = [[num(v) for v in re.findall(r'-?0x[0-9a-fA-F]+|-?\d+', r)] for r in re.findall(r"\{ (0x[^\n]*?) \},?$", m.group(1), re.M)]
assert len(schedule) == 99 and all(len(r) == 8 for r in schedule), len(schedule)


def lines(name):
    return [l for l in read(os.path.join(REF, 'LeafEdit-Core/strings/ww/en', name)).splitlines() if l.strip()]


data = {
    'chars': chars,
    'items': [[i, n, c] for i, n, c in items],
    'acres': [[i, n, c] for i, n, c in acres],
    'villagers': villagers,
    'palettes': palettes,
    'songs': songs,
    'encyclopedia': encyclopedia,
    'insects': insects, 'fish': fish, 'fossils': fossils, 'paintings': paintings,
    'emotions': emotions,
    'hairstyles': lines('hairstyle.txt'),
    'faces': lines('facetype.txt'),
    'hairColors': lines('haircolor.txt'),
    'personalities': lines('personalities.txt'),
    'nlPalette': nl_palette,
    'critters': critters,
    'weather': weather,
    'iconPalettes': icon_pals,
    'skyLines': sky_lines,
    'schedule': schedule,
}
with open(os.path.join(OUT, 'data.js'), 'w', encoding='utf-8') as f:
    f.write('// Generated by tools/build_data.py. Sources: ACSE (MIT), WildStorage (MIT), LeafEdit-Core string lists.\n')
    f.write('window.WW_DATA = ' + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n')

print('items', len(items), 'villagers', len(villagers), 'acres', len(acres), 'songs', len(songs), 'emotions', len(emotions))
