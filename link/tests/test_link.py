#!/usr/bin/env python3
# End-to-end tests of Leaflet Link's core, through the simulator (a simulated game card with fault injection):
#   make -C link sim && python3 link/tests/test_link.py link/host/leaflet-link-sim [a-real-save.sav]
# Without a save it makes a synthetic one that passes every checksum the game checks, so no game data is needed.
import json, os, random, shutil, struct, subprocess, sys, tempfile, time, urllib.parse, urllib.request, urllib.error, zlib

SIM = sys.argv[1]
BASE = 'http://127.0.0.1:8226'
BLOCK, COPY2, MAIN_CK, LETTERS, LETTERS_SIZE = 0x15FE0, 0x15FE0, 0x15FDC, 0x2E20C, 0x11DF4

def sum16(b, off, n): return sum(struct.unpack_from('<%dH' % (n // 2), b, off)) & 0xFFFF
def synthetic():
    rnd = random.Random(1)
    b = bytearray(rnd.getrandbits(8) if rnd.random() < 0.3 else 0 for _ in range(0x40000))
    b[0] = 0x8A
    b[COPY2:COPY2 + BLOCK] = b[:BLOCK]
    struct.pack_into('<H', b, 0x3FFFE, 0)
    struct.pack_into('<H', b, 0x3FFFE, (-sum16(b, LETTERS, LETTERS_SIZE)) & 0xFFFF)
    return fix(b)
def fix(b):
    for base in (0, COPY2):
        struct.pack_into('<H', b, base + MAIN_CK, 0)
        struct.pack_into('<H', b, base + MAIN_CK, (-sum16(b, base, BLOCK)) & 0xFFFF)
    return b

orig = open(sys.argv[2], 'rb').read()[:0x40000] if len(sys.argv) > 2 else None

def edited(region=None):
    b = bytearray(orig)
    for base in (0, COPY2):
        for k in range(0x40): b[base + 0x100 + k] ^= 0x5A
        b[base + 0x9000] ^= 0x33
        if region: b[base] = region
    return bytes(fix(b))

def req(method, path, body=None):
    r = urllib.request.Request(BASE + path, data=body, method=method)
    try:
        with urllib.request.urlopen(r, timeout=30) as f: return f.status, dict(f.headers), f.read()
    except urllib.error.HTTPError as e: return e.code, dict(e.headers), e.read()

def port_free():
    import socket
    with socket.socket() as t:
        t.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try: t.bind(('127.0.0.1', 8226)); return True
        except OSError: return False

def run(args, card=None, sd=None):
    # Another simulator still on the port would answer instead of this one.
    for _ in range(40):
        if port_free(): break
        time.sleep(0.05)
    else: sys.exit('Port 8226 is in use (another Leaflet Link simulator?). Stop it and run the tests again.')
    d = tempfile.mkdtemp()
    cp = os.path.join(d, "card.sav"); open(cp, "wb").write(orig if card is None else card)
    for rel, data in (sd or {}).items():   # files already on the simulated SD card
        f = os.path.join(d, 'sd', rel.lstrip('/')); os.makedirs(os.path.dirname(f), exist_ok=True); open(f, 'wb').write(data)
    # --abrupt-close: sockets drop unsent data on close, as the 3DS's network stack can.
    p = subprocess.Popen([SIM, '--card', cp, '--sd', os.path.join(d, 'sd'), '--abrupt-close', '--console'] + args, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    for _ in range(100):
        try: req('GET', '/info'); break
        except Exception: time.sleep(0.05)
    if p.poll() is not None: sys.exit('The simulator exited at once. Is another one still using port 8226?')
    return p, cp, d

def push(data, job=1):
    q = f'/save?crc={zlib.crc32(data):08x}&town=Maple&residents=Juniper&job={job}'
    return req('POST', q, data)

def wait_end(timeout=60):
    t = time.time()
    while time.time() - t < timeout:
        st = json.loads(req('GET', '/status')[2])
        if st['state'] in ('done', 'failed', 'idle') : return st
        time.sleep(0.05)
    raise RuntimeError('timeout')

results = []
def check(name, cond, info=''):
    results.append((name, cond)); print(('PASS ' if cond else 'FAIL ') + name + ('' if cond else f'  -> {info}'))

def stop(p, d):
    p.terminate(); p.wait(); out = p.stdout.read(); shutil.rmtree(d); return out

def sd_list(fresh=True):   # the SD card search runs in slices: ask until it's finished
    q = '/sd?fresh=1' if fresh else '/sd'
    for _ in range(400):
        code, _, b = req('GET', q)
        if code != 200: return code, None
        j = json.loads(b)
        if not j.get('scanning'): return code, j['saves']
        q = '/sd'; time.sleep(0.02)
    return 'timeout', None

def console(p, line):   # a choice on the console's own menu
    p.stdin.write(line + '\n'); p.stdin.flush()

BK = ('sd', '3ds', 'LeafletLink', 'backups')
def backups(d):
    b = os.path.join(d, *BK)
    return sorted(os.listdir(b)) if os.path.isdir(b) else []

if orig is None: orig = bytes(synthetic())
new = edited()
def npages(a, b): return sum(a[i:i+256] != b[i:i+256] for i in range(0, 0x40000, 256))

# 1 pull + push happy path
p, cp, d = run([])
info = json.loads(req('GET', '/info')[2]); check('info: ready and writable', info['card']['ready'] and info['card']['writable'], info)
code, hd, body = req('GET', '/save'); check('pull returns the card byte for byte', code == 200 and body == orig)
check('pull CRC header matches', hd.get('X-Leaflet-CRC32') == f'{zlib.crc32(body):08x}', hd)
code, _, b = push(new); check('push accepted', code == 200 and json.loads(b)['state'] in ('confirm', 'backup', 'writing'), b)
st = wait_end(); check('push done', st['state'] == 'done', st)
check('changed pages counted', st['changed'] == npages(orig, new) == 7 and st['written'] == 7, st)
time.sleep(0.1)
check('card now has the new save', open(cp, 'rb').read() == new)
bk = backups(d); check('SD backup kept', len(bk) == 1 and open(os.path.join(d, *BK, bk[0]), 'rb').read() == orig, bk)
code, _, body = req('GET', '/save'); check('pull after push returns new save', body == new)
# 2 identical
push(new, 2); st = wait_end(); check('identical save: nothing to write', st['state'] == 'done' and st['changed'] == 0, st)
check('identical save: no extra backup kept', len(backups(d)) == 1, backups(d))
# 3 bad inputs
code, _, b = req('POST', f'/save?crc={zlib.crc32(new) ^ 1:08x}&town=x', new); check('bad CRC refused', code == 400, (code, b))
bad = bytearray(new); bad[0x200] ^= 1
code, _, b = req('POST', f'/save?crc={zlib.crc32(bytes(bad)):08x}&town=x', bytes(bad)); check('bad checksum refused', code == 422, (code, b))
code, _, b = req('POST', f'/save?crc={zlib.crc32(new[:1000]):08x}', new[:1000]); check('wrong size refused', code == 400, (code, b))
code, _, b = req('OPTIONS', '/save'); check('CORS preflight', code == 204)
stop(p, d)

# 4 person says no
p, cp, d = run(['--answer', 'no'])
push(new); st = wait_end(); check('cancel on console: nothing written', st['state'] == 'idle' and 'cancel' in st['message'].lower(), st)
check('card untouched after cancel', open(cp, 'rb').read() == orig); stop(p, d)

# 5 chip that only takes erase + program
p, cp, d = run(['--chip', 'plain']); push(new); st = wait_end(); time.sleep(0.1)
check('plain chip: falls back and saves', st['state'] == 'done' and open(cp, 'rb').read() == new, st); stop(p, d)

# 6 flaky reads
p, cp, d = run(['--flaky-reads', '97'])
code, _, body = req('GET', '/save'); check('flaky reads: pull still exact', code == 200 and body == orig, code)
push(new); st = wait_end(); time.sleep(0.1)
check('flaky reads: push verified', st['state'] == 'done' and open(cp, 'rb').read() == new, st); stop(p, d)

# 7 stuck page: fail and restore
p, cp, d = run(['--stuck-page', '0x9000']); push(new); st = wait_end(); time.sleep(0.1)
check('stuck page: fails and restores original', st['state'] == 'failed' and st['restored'] and open(cp, 'rb').read() == orig, st); stop(p, d)

# 8 deaf for a few writes: retries succeed
p, cp, d = run(['--deaf-pages', '1']); push(new); st = wait_end(); time.sleep(0.1)
check('retry after an ignored write', st['state'] == 'done' and open(cp, 'rb').read() == new, st); stop(p, d)

# 9 card pulled mid-write
p, cp, d = run(['--pull-at', '1']); push(new); st = wait_end(); check('card pulled: reports it', st['state'] == 'failed' and 'taken out' in st['message'], st); stop(p, d)

# 10 low battery
p, cp, d = run(['--low-battery']); push(new); st = wait_end(); time.sleep(0.1)
check('low battery: nothing written', st['state'] == 'failed' and 'battery' in st['message'] and open(cp, 'rb').read() == orig, st); stop(p, d)

# 11 eeprom chip
p, cp, d = run(['--chip', 'eeprom'])
info = json.loads(req('GET', '/info')[2]); check('wrong chip: not ready', not info['card']['ready'], info)
code, _, b = push(new); check('wrong chip: push refused', code == 409, (code, b)); stop(p, d)

# 12 region mismatch
p, cp, d = run([]); push(edited(0xC5)); st = wait_end(); time.sleep(0.1)
check('region mismatch: nothing written', st['state'] == 'failed' and 'European' in st['message'] or 'Europe' in st['message'], st)
check('region mismatch: card untouched', open(cp, 'rb').read() == orig); stop(p, d)

# 13 blank card accepts a save
p, cp, d = run([], card=b'\xff' * 0x40000); push(new); st = wait_end(); time.sleep(0.1)
check('blank card: saves', st['state'] == 'done' and open(cp, 'rb').read() == new, st); stop(p, d)

# 14 full rewrite (every page differs)
p, cp, d = run([], card=b'\x00' * 0x40000); push(new); st = wait_end(); time.sleep(0.1)
check('whole-chip rewrite', st['state'] == 'done' and st['changed'] == npages(b'\x00' * 0x40000, new) and open(cp, 'rb').read() == new, st); stop(p, d)

# 15 Leaflet Link updates
app = b'3DSX' + bytes(random.Random(2).getrandbits(8) for _ in range(300000))
def upd(data, crc=None, version='9.9'):
    return req('POST', f'/update?crc={(zlib.crc32(data) if crc is None else crc):08x}&version={version}&job=7', data)
p, cp, d = run([])
code, _, b = upd(app); st = wait_end(); time.sleep(0.1)
inst = os.path.join(d, 'sd', '3ds', 'LeafletLink.3dsx')
check('update: installed', code == 200 and st['state'] == 'done' and open(inst, 'rb').read() == app, (code, st))
code, _, b = upd(b'XXXX' + app[4:]); check('update: not a .3dsx refused', code == 400, (code, b))
code, _, b = upd(app, zlib.crc32(app) ^ 1); check('update: bad CRC refused', code == 400, (code, b))
try: code = req('POST', '/update?crc=00000000', b'3DSX' + b'\0' * (0x400000 + 10))[0]
except urllib.error.URLError: code = 'closed'   # refused from the header, before the body was sent
check('update: too big refused', code in (413, 'closed') and req('GET', '/info')[0] == 200, code)
stop(p, d)
p, cp, d = run(['--answer', 'no']); upd(app); st = wait_end()
check('update: cancel on console leaves the old app', st['state'] == 'idle' and not os.path.exists(os.path.join(d, 'sd', '3ds', 'LeafletLink.3dsx')), st); stop(p, d)

# 16 the console's own Back up
def status(): return json.loads(req('GET', '/status')[2])
p, cp, d = run([])
import socket
u = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); u.settimeout(2)
u.sendto(b'leaflet-link?', ('127.0.0.1', 8226))
try: ans = u.recvfrom(64)[0].decode()
except OSError: ans = ''
u.close()
check('discovery: answers with its version and the card', ans.startswith('leaflet-link ') and ans.endswith(' ADME'), ans)
info = json.loads(req('GET', '/info')[2]); check('info lists the new features', set(info.get('features', [])) >= {'sd', 'health'}, info)
console(p, 'backup'); st = wait_end()
bk = backups(d)
check('console backup: done and kept byte for byte', st['state'] == 'done' and st['kind'] == 'backup' and len(bk) == 1 and 'backup' in bk[0] and open(os.path.join(d, *BK, bk[0]), 'rb').read() == orig, (st, bk))
check('console backup: card untouched', open(cp, 'rb').read() == orig)
stop(p, d)
p, cp, d = run([], card=b'\xff' * 0x40000); console(p, 'backup'); st = wait_end()
check('console backup: blank card has nothing to back up', st['state'] == 'failed' and 'never been saved' in st['message'] and not backups(d), st); stop(p, d)

# 17 saves on the SD card: Leaflet Link's backups and TWiLight Menu++ / nds-bootstrap saves
TW = '/roms/nds/saves/Animal Crossing - Wild World (USA).sav'
pad = new + b'\xff' * 0x40000                     # some loaders keep a 512 KB file
other = bytes(random.Random(3).getrandbits(8) for _ in range(0x40000))   # another game's save
other = b'\x00' + other[1:0x15FE0] + b'\x00' + other[0x15FE1:]
broken = bytearray(new); broken[0x300] ^= 0xFF      # a damaged Wild World save
sd = {TW: pad, '/roms/nds/saves/Mario Kart DS.sav': other, '/roms/nds/Animal Crossing.sav2': bytes(broken),
      '/Nintendo 3DS/hidden/x.sav': new, '/3ds/LeafletLink/backups/2026-01-02 03.04.05 ADME backup.sav': orig, '/roms/nds/notes.txt': b'hi'}
p, cp, d = run([], sd=sd)
code, lst = sd_list(); lst = lst or []
paths = [x['path'] for x in lst]
check('SD list: finds the backup, the TWiLight save and the damaged one', set(paths) == {TW, '/roms/nds/Animal Crossing.sav2', '/3ds/LeafletLink/backups/2026-01-02 03.04.05 ADME backup.sav'}, paths)
by = {x['path']: x for x in lst}
check('SD list: kinds, sizes and checks', by.get(TW, {}).get('kind') == 'game' and by[TW]['size'] == len(pad) and by[TW]['ok'] and not by['/roms/nds/Animal Crossing.sav2']['ok'] and by['/3ds/LeafletLink/backups/2026-01-02 03.04.05 ADME backup.sav']['kind'] == 'backup', lst)
check('SD list: a backup\'s time comes from its name', by['/3ds/LeafletLink/backups/2026-01-02 03.04.05 ADME backup.sav']['saved'] == '2026-01-02 03:04:05', lst)
code, hd, b = req('GET', '/sd/file?path=' + urllib.parse.quote(TW))
check('SD file: first 256 KB with its CRC', code == 200 and b == new and hd.get('X-Leaflet-CRC32') == f'{zlib.crc32(b):08x}', code)
code, _, _ = req('GET', '/sd/file?path=' + urllib.parse.quote('/roms/nds/notes.txt')); check('SD file: unlisted files refused', code == 404, code)
code, _, _ = req('GET', '/sd/file?path=' + urllib.parse.quote('/../card.sav')); check('SD file: paths outside the list refused', code == 404, code)
# Send a town to the TWiLight save: the old file is kept, the padding stays.
def push_sd(path, data, job=5):
    return req('POST', f'/sd/file?path={urllib.parse.quote(path)}&crc={zlib.crc32(data):08x}&town=Maple&job={job}', data)
code, _, b = push_sd(TW, orig); st = wait_end(); time.sleep(0.1)
twf = os.path.join(d, 'sd', TW.lstrip('/'))
check('SD write: done and checked', code == 200 and st['state'] == 'done' and st['kind'] == 'sdfile', (code, b, st))
check('SD write: file has the new save and keeps its padding', open(twf, 'rb').read() == orig + b'\xff' * 0x40000)
kept = [f for f in backups(d) if 'before Leaflet' in f]
check('SD write: old file kept in backups', len(kept) == 1 and open(os.path.join(d, *BK, kept[0]), 'rb').read() == pad, kept)
check('SD write: no temporary file left', not os.path.exists(twf + '.leaflet-new'))
code, _, b = push_sd('/3ds/LeafletLink/backups/2026-01-02 03.04.05 ADME backup.sav', new); check('SD write: backups are read-only', code == 409, (code, b))
code, _, b = push_sd(TW, edited(0xC5)); check('SD write: region mismatch refused', code == 409, (code, b))
code, _, b = push_sd(TW, bytes(broken)); check('SD write: damaged save refused', code == 422, (code, b))
# Console restore from the SD card onto the game card.
console(p, 'scan'); time.sleep(0.3)
code, lst = sd_list()
idx = [x['path'] for x in lst].index(TW)
console(p, f'restore {idx}'); st = wait_end(); time.sleep(0.1)
check('console restore: TWiLight save put on the game card', st['state'] == 'done' and st['kind'] == 'card' and 'Animal Crossing' in st['source'] and open(cp, 'rb').read() == orig, st)
idx = [x['path'] for x in lst].index('/roms/nds/Animal Crossing.sav2')
console(p, f'restore {idx}'); time.sleep(0.4); st = status()
check('console restore: damaged save refused', st['state'] in ('done', 'idle') and open(cp, 'rb').read() == orig, st)
stop(p, d)
# A big SD card: the search runs in slices, so the 3DS keeps answering meanwhile.
big = {f'/roms/nds/game{i:04d}/saves/game{i:04d}.sav': b'\x00' * 0x40000 for i in range(400)}
big.update({f'/music/album{i:03d}/track{k:02d}.mp3': b'x' for i in range(60) for k in range(20)})
big[TW] = pad
p, cp, d = run([], sd=big)
t0 = time.time(); code, _, b = req('GET', '/sd?fresh=1'); first = json.loads(b)
info_ok = req('GET', '/info')[0] == 200
code, lst = sd_list(fresh=False)
check('big SD card: answers at once and keeps answering while it looks', first.get('scanning') is True and info_ok, first.get('scanning'))
check('big SD card: finds the save among 1,600 files', lst is not None and [x['path'] for x in lst] == [TW], (code, lst and [x['path'] for x in lst]))
stop(p, d)
p, cp, d = run(['--answer', 'no'], sd={TW: pad}); push_sd(TW, orig); st = wait_end(); time.sleep(0.1)
check('SD write: cancel on console leaves the file', st['state'] == 'idle' and open(os.path.join(d, 'sd', TW.lstrip('/')), 'rb').read() == pad, st); stop(p, d)

# 18 health check
p, cp, d = run([]); code, _, b = req('POST', '/health'); st = wait_end()
h = st.get('health') or {}
check('health: healthy card', code == 200 and st['state'] == 'done' and st['kind'] == 'health' and h.get('passes') == h.get('of') == 6 and h.get('unstable') == 0 and h.get('check') == 0 and not st['caution'], st)
check('health: card untouched', open(cp, 'rb').read() == orig); stop(p, d)
p, cp, d = run(['--flaky-reads', '40']); req('POST', '/health'); st = wait_end(); h = st.get('health') or {}
check('health: dirty contacts found', st['state'] == 'done' and h.get('unstable', 0) > 0 and h.get('flips', 0) > 0 and st['caution'] and h.get('check') == 0, st); stop(p, d)
bad = bytearray(orig); bad[0x200] ^= 1
p, cp, d = run([], card=bytes(bad)); req('POST', '/health'); st = wait_end(); h = st.get('health') or {}
check('health: damaged save reported', st['state'] == 'done' and h.get('unstable') == 0 and h.get('check') == 2 and st['caution'], st); stop(p, d)
p, cp, d = run(['--chip', 'eeprom']); code, _, b = req('POST', '/health'); check('health: wrong chip refused', code == 409, (code, b)); stop(p, d)
p, cp, d = run(['--slow', '0']); req('POST', '/health'); console(p, 'stop'); st = wait_end()
check('health: stopping it is harmless', st['state'] in ('idle', 'done') and open(cp, 'rb').read() == orig, st); stop(p, d)

print(f"\n{sum(1 for _, c in results if c)}/{len(results)} passed")
sys.exit(0 if all(c for _, c in results) else 1)
