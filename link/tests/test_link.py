#!/usr/bin/env python3
# End-to-end tests of Leaflet Link's core, through the simulator (a simulated game card with fault injection):
#   make -C link sim && python3 link/tests/test_link.py link/host/leaflet-link-sim [a-real-save.sav]
# Without a save it makes a synthetic one that passes every checksum the game checks, so no game data is needed.
import json, os, random, shutil, struct, subprocess, sys, tempfile, time, urllib.request, urllib.error, zlib

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

def run(args, card=None):
    d = tempfile.mkdtemp()
    cp = os.path.join(d, "card.sav"); open(cp, "wb").write(orig if card is None else card)
    # --abrupt-close: sockets drop unsent data on close, as the 3DS's network stack can.
    p = subprocess.Popen([SIM, '--card', cp, '--sd', os.path.join(d, 'sd'), '--abrupt-close'] + args, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
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
bk = [f for f in os.listdir(os.path.join(d, 'sd', 'backups'))]; check('SD backup kept', len(bk) == 1 and open(os.path.join(d, 'sd', 'backups', bk[0]), 'rb').read() == orig, bk)
code, _, body = req('GET', '/save'); check('pull after push returns new save', body == new)
# 2 identical
push(new, 2); st = wait_end(); check('identical save: nothing to write', st['state'] == 'done' and st['changed'] == 0, st)
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
inst = os.path.join(d, 'sd', 'LeafletLink.3dsx')
check('update: installed', code == 200 and st['state'] == 'done' and open(inst, 'rb').read() == app, (code, st))
code, _, b = upd(b'XXXX' + app[4:]); check('update: not a .3dsx refused', code == 400, (code, b))
code, _, b = upd(app, zlib.crc32(app) ^ 1); check('update: bad CRC refused', code == 400, (code, b))
try: code = req('POST', '/update?crc=00000000', b'3DSX' + b'\0' * (0x400000 + 10))[0]
except urllib.error.URLError: code = 'closed'   # refused from the header, before the body was sent
check('update: too big refused', code in (413, 'closed') and req('GET', '/info')[0] == 200, code)
stop(p, d)
p, cp, d = run(['--answer', 'no']); upd(app); st = wait_end()
check('update: cancel on console leaves the old app', st['state'] == 'idle' and not os.path.exists(os.path.join(d, 'sd', 'LeafletLink.3dsx')), st); stop(p, d)

print(f"\n{sum(1 for _, c in results if c)}/{len(results)} passed")
sys.exit(0 if all(c for _, c in results) else 1)
