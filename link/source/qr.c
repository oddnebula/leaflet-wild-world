// A QR code for Leaflet's address on the 3DS ("http://192.168.1.23:8226/"), so a phone's camera can open it.
// Version 3 (29x29), error correction M, byte mode: up to 42 bytes. The mask is chosen by the standard's penalty
// rules. Follows ISO/IEC 18004 the way Nayuki's reference QR generator lays it out.
#include "qr.h"
#include <string.h>

#define N LL_QR_SIZE
#define DATA 44   // data codewords for 3-M
#define ECC 26    // error correction codewords (one block)

static uint8_t mod[N][N], fn[N][N];   // [y][x]: dark, and part of the fixed pattern

static void set_fn(int x, int y, int dark) { mod[y][x] = (uint8_t)dark; fn[y][x] = 1; }

static uint8_t gf_mul(uint8_t a, uint8_t b) {
  int z = 0;
  for (int i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >> 7) * 0x11D); z ^= ((b >> i) & 1) * a; }
  return (uint8_t)z;
}

static void draw_format(int mask) {
  int data = (0 << 3) | mask, rem = data;   // level M is 00
  for (int i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >> 9) * 0x537);
  int bits = ((data << 10) | rem) ^ 0x5412;
  for (int i = 0; i <= 5; i++) set_fn(8, i, (bits >> i) & 1);
  set_fn(8, 7, (bits >> 6) & 1); set_fn(8, 8, (bits >> 7) & 1); set_fn(7, 8, (bits >> 8) & 1);
  for (int i = 9; i < 15; i++) set_fn(14 - i, 8, (bits >> i) & 1);
  for (int i = 0; i < 8; i++) set_fn(N - 1 - i, 8, (bits >> i) & 1);
  for (int i = 8; i < 15; i++) set_fn(8, N - 15 + i, (bits >> i) & 1);
  set_fn(8, N - 8, 1);   // the dark module
}

static void finder(int cx, int cy) {
  for (int dy = -4; dy <= 4; dy++) for (int dx = -4; dx <= 4; dx++) {
    int x = cx + dx, y = cy + dy, d = dx < 0 ? -dx : dx, e = dy < 0 ? -dy : dy;
    if (e > d) d = e;
    if (x >= 0 && x < N && y >= 0 && y < N) set_fn(x, y, d != 2 && d != 4);
  }
}

static int masked(int mask, int x, int y) {
  switch (mask) {
    case 0: return (x + y) % 2 == 0;
    case 1: return y % 2 == 0;
    case 2: return x % 3 == 0;
    case 3: return (x + y) % 3 == 0;
    case 4: return (x / 3 + y / 2) % 2 == 0;
    case 5: return x * y % 2 + x * y % 3 == 0;
    case 6: return (x * y % 2 + x * y % 3) % 2 == 0;
    default: return ((x + y) % 2 + x * y % 3) % 2 == 0;
  }
}
static void apply_mask(int mask) {
  for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) if (!fn[y][x] && masked(mask, x, y)) mod[y][x] ^= 1;
}

// The standard's four penalty rules: long runs, 2x2 blocks, finder look-alikes, and an uneven dark share.
static long penalty(void) {
  long p = 0; int dark = 0;
  for (int pass = 0; pass < 2; pass++) for (int a = 0; a < N; a++) {
    int run = 0, last = -1;
    for (int b = 0; b < N; b++) {
      int c = pass ? mod[b][a] : mod[a][b];
      if (c == last) { if (++run == 5) p += 3; else if (run > 5) p++; } else { last = c; run = 1; }
    }
    for (int b = 0; b + 10 < N; b++) {
      static const uint8_t pat[11] = { 1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0 };
      int f = 1, r = 1;
      for (int k = 0; k < 11; k++) { int c = pass ? mod[b + k][a] : mod[a][b + k]; if (c != pat[k]) f = 0; if (c != pat[10 - k]) r = 0; }
      p += 40 * (f + r);
    }
  }
  for (int y = 0; y < N; y++) for (int x = 0; x < N; x++) {
    dark += mod[y][x];
    if (x + 1 < N && y + 1 < N && mod[y][x] == mod[y][x + 1] && mod[y][x] == mod[y + 1][x] && mod[y][x] == mod[y + 1][x + 1]) p += 3;
  }
  int k = (dark * 100 / (N * N)) - 50; if (k < 0) k = -k;
  return p + (k / 5) * 10;
}

bool ll_qr(const char *text, uint8_t out[LL_QR_SIZE][LL_QR_SIZE]) {
  size_t len = strlen(text);
  if (len > 42) return false;
  // Codewords: mode 0100, an 8-bit count, the bytes, a terminator, then the pad bytes EC 11.
  uint8_t cw[DATA + ECC] = { 0 };
  int bit = 0;
  #define PUT(v, n) for (int i_ = (n) - 1; i_ >= 0; i_--, bit++) if (((v) >> i_) & 1) cw[bit >> 3] |= (uint8_t)(0x80 >> (bit & 7))
  PUT(4, 4); PUT((int)len, 8);
  for (size_t i = 0; i < len; i++) PUT((uint8_t)text[i], 8);
  bit += 4; if (bit > DATA * 8) bit = DATA * 8;
  #undef PUT
  for (int i = (bit + 7) / 8, pad = 0xEC; i < DATA; i++, pad ^= 0xEC ^ 0x11) cw[i] = (uint8_t)pad;
  // Reed-Solomon over GF(256): the generator's coefficients, then the remainder.
  uint8_t gen[ECC] = { 0 }; gen[ECC - 1] = 1;
  uint8_t root = 1;
  for (int i = 0; i < ECC; i++) {
    for (int j = 0; j < ECC; j++) { gen[j] = gf_mul(gen[j], root); if (j + 1 < ECC) gen[j] ^= gen[j + 1]; }
    root = gf_mul(root, 2);
  }
  uint8_t *rem = cw + DATA;
  for (int i = 0; i < DATA; i++) {
    uint8_t f = cw[i] ^ rem[0];
    memmove(rem, rem + 1, ECC - 1); rem[ECC - 1] = 0;
    for (int j = 0; j < ECC; j++) rem[j] ^= gf_mul(gen[j], f);
  }
  // Fixed patterns: timing, finders, the alignment pattern at (22, 22), and room for the format bits.
  memset(mod, 0, sizeof mod); memset(fn, 0, sizeof fn);
  for (int i = 0; i < N; i++) { set_fn(6, i, i % 2 == 0); set_fn(i, 6, i % 2 == 0); }
  finder(3, 3); finder(N - 4, 3); finder(3, N - 4);
  for (int dy = -2; dy <= 2; dy++) for (int dx = -2; dx <= 2; dx++) { int d = dx < 0 ? -dx : dx, e = dy < 0 ? -dy : dy; set_fn(22 + dx, 22 + dy, (d > e ? d : e) != 1); }
  draw_format(0);
  // Data in two-column zigzags from the bottom right, skipping the vertical timing column.
  int i = 0;
  for (int right = N - 1; right >= 1; right -= 2) {
    if (right == 6) right = 5;
    for (int v = 0; v < N; v++) for (int j = 0; j < 2; j++) {
      int x = right - j, up = ((right + 1) & 2) == 0, y = up ? N - 1 - v : v;
      if (!fn[y][x] && i < (DATA + ECC) * 8) { mod[y][x] = (cw[i >> 3] >> (7 - (i & 7))) & 1; i++; }
    }
  }
  int best = 0; long bestP = -1;
  for (int m = 0; m < 8; m++) {
    apply_mask(m); draw_format(m);
    long p = penalty();
    if (bestP < 0 || p < bestP) { bestP = p; best = m; }
    apply_mask(m);   // undo (the format bits are redrawn each time)
  }
  apply_mask(best); draw_format(best);
  memcpy(out, mod, sizeof mod);
  return true;
}
