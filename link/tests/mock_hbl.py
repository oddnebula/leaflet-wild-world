#!/usr/bin/env python3
# A stand-in for the Homebrew Launcher's network receiver (press Y in the launcher), written from
# 3ds-hbmenu/source/ui/netloader.c, to test Leaflet's wireless install without a 3DS:
#   python3 link/tests/mock_hbl.py OUT_DIR [--once] [--udp-bind BROADCAST_ADDR]
# On one computer the sender and this mock both use UDP 17491; binding the mock to the network's broadcast address
# (say 192.168.0.255) lets the answer reach the sender, as it does from a real 3DS.
# Answers "3dsboot" broadcasts with "boot3ds" (sent to UDP 17491 on the asker), accepts one TCP transfer on 17491:
# int32 name length, name, int32 file size -> int32 0; then zlib data as (int32 chunk length, chunk) pairs, each at
# most 16 KB, until the stream ends -> int32 0; then int32 argument length and the arguments. The file is saved as
# OUT_DIR/<name>; a summary line is printed.
import os, select, socket, struct, sys, zlib
out_dir = sys.argv[1]; os.makedirs(out_dir, exist_ok=True)
PORT = 17491
udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
try: udp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
except OSError: pass
udp.bind((sys.argv[sys.argv.index('--udp-bind') + 1] if '--udp-bind' in sys.argv else '', PORT))
reply = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
tcp = socket.socket(); tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); tcp.bind(('', PORT)); tcp.listen(1)
print('mock launcher ready', flush=True)
def recvall(c, n):
    b = b''
    while len(b) < n:
        k = c.recv(n - len(b))
        if not k: raise EOFError('closed after %d of %d bytes' % (len(b), n))
        b += k
    return b
while True:
    r, _, _ = select.select([udp, tcp], [], [])
    if udp in r:
        data, (ip, _) = udp.recvfrom(256)
        if data.startswith(b'3dsboot'):
            reply.sendto(b'boot3ds', (ip, PORT)); print('answered discovery from', ip, flush=True)
        continue
    c, addr = tcp.accept()
    try:
        n = struct.unpack('<i', recvall(c, 4))[0]; name = recvall(c, n).decode()
        size = struct.unpack('<i', recvall(c, 4))[0]
        c.sendall(struct.pack('<i', 0))
        d = zlib.decompressobj(); body = b''; chunks = 0; biggest = 0
        while not d.eof:
            k = struct.unpack('<I', recvall(c, 4))[0]
            if k > 16 * 1024: raise ValueError('chunk of %d bytes is bigger than the launcher buffer' % k)
            body += d.decompress(recvall(c, k)); chunks += 1; biggest = max(biggest, k)
        c.sendall(struct.pack('<i', 0))
        alen = struct.unpack('<i', recvall(c, 4))[0]; args = recvall(c, alen) if alen else b''
        open(os.path.join(out_dir, name), 'wb').write(body)
        print(f'RECEIVED {name} {len(body)} bytes (declared {size}) in {chunks} chunks (largest {biggest}) args={args!r} crc={zlib.crc32(body):08x}', flush=True)
    except Exception as e:
        print('ERROR', e, flush=True)
    c.close()
    if '--once' in sys.argv: break
