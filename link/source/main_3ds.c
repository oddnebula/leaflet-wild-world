// Leaflet Link for 3DS: the console side of Cartridge Sync. It serves the Wild World game card's save to Leaflet on
// the same Wi-Fi network, and writes a save from Leaflet back to the card after the person confirms on the console.
// On its own it also backs the card up to the SD card, puts a backup (or a TWiLight Menu++ save) back on the card,
// and checks the card's save chip.
// Everything here is the 3DS layer (hardware access and the screens); the logic lives in core.c.
#include <3ds.h>
#include <citro2d.h>
#include <malloc.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <arpa/inet.h>

#include "core.h"

#define SOC_ALIGN 0x1000
#define SOC_SIZE 0x100000

// ---- platform -----------------------------------------------------------------------------------------------------
bool plat_spi(const uint8_t *cmd, size_t cmdLen, uint8_t *rx, size_t rxLen, const uint8_t *tx, size_t txLen) {
  u8 op = pxiDevMakeTransferOption(BAUDRATE_4MHZ, BUSMODE_1BIT);
  u64 wait = pxiDevMakeWaitOperation(WAIT_NONE, DEASSERT_NONE, 0LL);
  u64 none = 0;
  // Chip-select stays asserted from the command through the read and the write that follow it.
  PXIDEV_SPIBuffer header = { &none, 0, op, wait };
  PXIDEV_SPIBuffer w1 = { (void *)cmd, (u32)cmdLen, op, wait };
  PXIDEV_SPIBuffer r1 = { rx, (u32)rxLen, op, wait };
  PXIDEV_SPIBuffer w2 = { (void *)tx, (u32)txLen, op, wait };
  PXIDEV_SPIBuffer r2 = { NULL, 0, op, wait };
  PXIDEV_SPIBuffer footer = { &none, 0, op, wait };
  return R_SUCCEEDED(PXIDEV_SPIMultiWriteRead(&header, &w1, &r1, &w2, &r2, &footer));
}

void plat_card(LLCard *c) {
  memset(c, 0, sizeof *c);
  bool in = false;
  if (R_FAILED(FSUSER_CardSlotIsInserted(&in)) || !in) return;
  c->present = true;
  FS_CardType type;
  if (R_FAILED(FSUSER_GetCardType(&type)) || type != CARD_TWL) return;
  c->ds = true;
  static u8 header[0x3B4];
  if (R_SUCCEEDED(FSUSER_GetLegacyRomHeader(MEDIATYPE_GAME_CARD, 0LL, header))) {
    memcpy(c->title, header, 12);
    memcpy(c->code, header + 12, 4);
    for (int i = 0; i < 12; i++) if (c->title[i] && (c->title[i] < 0x20 || c->title[i] > 0x7E)) c->title[i] = '?';
  }
}

uint64_t plat_ms(void) { return osGetTime(); }

const char *plat_sd_root(void) { return "sdmc:"; }
// The SD card's timestamps are the console's clock, like time() (seconds since 1970).
int64_t plat_mtime(const char *full) { u64 t = 0; return R_SUCCEEDED(archive_getmtime(full, &t)) ? (int64_t)t : 0; }

bool plat_power_ok(char *why, size_t cap) {
  u8 level = 5, charging = 0;
  PTMU_GetBatteryLevel(&level);
  PTMU_GetBatteryChargeState(&charging);
  if (level >= 2 || charging) return true;
  snprintf(why, cap, "The 3DS battery is low. Plug in the charger, then send the save again.");
  return false;
}

void plat_socket_opened(int fd) { (void)fd; }

void plat_hold(bool busy) { aptSetHomeAllowed(!busy); aptSetSleepAllowed(!busy); }

// Where this app lives on the SD card: from argv[0] when the Homebrew Launcher passes it.
static char appPath[256] = "sdmc:/3ds/LeafletLink.3dsx";

static bool same_file(const char *path, const uint8_t *d, size_t n) {
  FILE *f = fopen(path, "rb");
  if (!f) return false;
  static u8 buf[0x4000];
  size_t at = 0, k;
  bool ok = true;
  while (ok && (k = fread(buf, 1, sizeof buf, f)) > 0) { ok = at + k <= n && !memcmp(buf, d + at, k); at += k; }
  fclose(f);
  return ok && at == n;
}

bool plat_install_app(const uint8_t *d, size_t n, char *why, size_t cap) {
  char tmp[270];
  snprintf(tmp, sizeof tmp, "%s.new", appPath);
  FILE *f = fopen(tmp, "wb");
  bool ok = f && fwrite(d, 1, n, f) == n;
  if (f) ok = fclose(f) == 0 && ok;
  if (!ok || !same_file(tmp, d, n)) { remove(tmp); snprintf(why, cap, "The update couldn't be written to the SD card (is it full or locked?)."); return false; }
  remove(appPath);
  if (rename(tmp, appPath) != 0 || !same_file(appPath, d, n)) { snprintf(why, cap, "The update is on the SD card as %s, but couldn't replace the old app. Rename it to LeafletLink.3dsx.", tmp + 5); return false; }
  return true;
}

// time() on the 3DS is the console's clock as set in System Settings (wall time, no time zone), which is also the
// clock DS games read.
void plat_clock(char *out, size_t cap) { time_t t = time(NULL); strftime(out, cap, "%Y-%m-%d %H:%M:%S", gmtime(&t)); }

void plat_stamp(char *out, size_t cap) { time_t t = time(NULL); strftime(out, cap, "%Y-%m-%d %H.%M.%S", gmtime(&t)); }

// ---- drawing ------------------------------------------------------------------------------------------------------
// Leaflet's colors: sky, leaf green, warm paper.
#define SKY_TOP    C2D_Color32(0x8E, 0xD3, 0xF5, 0xFF)
#define SKY_LOW    C2D_Color32(0xD8, 0xF1, 0xFB, 0xFF)
#define GRASS      C2D_Color32(0x7C, 0xC5, 0x5A, 0xFF)
#define GRASS_DARK C2D_Color32(0x5E, 0xA8, 0x42, 0xFF)
#define PAPER      C2D_Color32(0xFF, 0xFA, 0xEC, 0xFF)
#define STRIPE     C2D_Color32(0xF6, 0xEE, 0xD8, 0xFF)
#define CARD       C2D_Color32(0xFF, 0xFF, 0xFF, 0xF2)
#define INK        C2D_Color32(0x4A, 0x3B, 0x2A, 0xFF)
#define MUTED      C2D_Color32(0x8C, 0x7B, 0x66, 0xFF)
#define LEAF       C2D_Color32(0x3F, 0xA3, 0x4D, 0xFF)
#define LEAF_LIGHT C2D_Color32(0x8B, 0xD3, 0x6C, 0xFF)
#define RED        C2D_Color32(0xE0, 0x5A, 0x4E, 0xFF)
#define AMBER      C2D_Color32(0xF2, 0xA9, 0x3B, 0xFF)
#define GREY       C2D_Color32(0xD9, 0xD0, 0xC0, 0xFF)
#define WHITE      C2D_Color32(0xFF, 0xFF, 0xFF, 0xFF)
#define SHADOW     C2D_Color32(0x00, 0x00, 0x00, 0x22)

static C2D_TextBuf tbuf;
// Single lines shrink to fit: centered ones to textMax wide, left-aligned ones to end before textRight.
static float textMax = 360, textRight = 380;

static void rrect(float x, float y, float w, float h, float r, u32 c) {
  C2D_DrawRectSolid(x + r, y, 0, w - 2 * r, h, c);
  C2D_DrawRectSolid(x, y + r, 0, r, h - 2 * r, c);
  C2D_DrawRectSolid(x + w - r, y + r, 0, r, h - 2 * r, c);
  C2D_DrawCircleSolid(x + r, y + r, 0, r, c); C2D_DrawCircleSolid(x + w - r, y + r, 0, r, c);
  C2D_DrawCircleSolid(x + r, y + h - r, 0, r, c); C2D_DrawCircleSolid(x + w - r, y + h - r, 0, r, c);
}
static void panel(float x, float y, float w, float h, u32 c) { rrect(x, y + 3, w, h, 12, SHADOW); rrect(x, y, w, h, 12, c); }

enum { LEFT = 0, CENTER = 1 };
// Draws text and returns its height. wrap > 0 wraps at that width (left-aligned).
static float text(const char *s, float x, float y, float size, u32 color, int align, float wrap) {
  C2D_Text t;
  C2D_TextParse(&t, tbuf, s);
  C2D_TextOptimize(&t);
  float w = 0, h = 0;
  if (wrap > 0) {
    C2D_DrawText(&t, C2D_WithColor | C2D_WordWrap, x, y, 0, size, size, color, wrap);
    // Height of wrapped text: measure line by line is costly; estimate from width.
    C2D_TextGetDimensions(&t, size, size, &w, &h);
    return h * ceilf(w / wrap + 0.15f);
  }
  C2D_TextGetDimensions(&t, size, size, &w, &h);
  float room = align == CENTER ? textMax : textRight - x;
  if (w > room) { float k = room / w; size *= k; w *= k; y += h * (1 - k) / 2; h *= k; }
  C2D_DrawText(&t, C2D_WithColor, align == CENTER ? x - w / 2 : x, y, 0, size, size, color);
  return h;
}

// Leaflet's leaf: two arcs meeting at the tips, with a vein.
static void leaf(float cx, float cy, float len, float wid, u32 c, u32 vein) {
  const int N = 14;
  float px[2 * N + 2], py[2 * N + 2];
  int k = 0;
  for (int i = 0; i <= N; i++) { float t = (float)i / N; px[k] = cx - len / 2 + len * t; py[k] = cy - wid * sinf((float)M_PI * t) * (1 - 0.25f * t); k++; }
  for (int i = N; i >= 0; i--) { float t = (float)i / N; px[k] = cx - len / 2 + len * t; py[k] = cy + wid * sinf((float)M_PI * t) * (0.6f + 0.15f * t); k++; }
  // Tilt it a little, like the app icon.
  const float a = -0.45f, ca = cosf(a), sa = sinf(a);
  for (int i = 0; i < k; i++) { float dx = px[i] - cx, dy = py[i] - cy; px[i] = cx + dx * ca - dy * sa; py[i] = cy + dx * sa + dy * ca; }
  for (int i = 1; i + 1 < k; i++) C2D_DrawTriangle(px[0], py[0], c, px[i], py[i], c, px[i + 1], py[i + 1], c, 0);
  C2D_DrawLine(px[0], py[0], vein, px[N], py[N], vein, 1.5f, 0);
}

static void tick_mark(float cx, float cy, float r, u32 bg) {
  C2D_DrawCircleSolid(cx, cy, 0, r, bg);
  C2D_DrawLine(cx - r * 0.45f, cy + r * 0.02f, WHITE, cx - r * 0.1f, cy + r * 0.38f, WHITE, r * 0.22f, 0);
  C2D_DrawLine(cx - r * 0.1f, cy + r * 0.38f, WHITE, cx + r * 0.5f, cy - r * 0.35f, WHITE, r * 0.22f, 0);
}
static void bang_mark(float cx, float cy, float r, u32 bg) {
  C2D_DrawCircleSolid(cx, cy, 0, r, bg);
  C2D_DrawLine(cx, cy - r * 0.5f, WHITE, cx, cy + r * 0.12f, WHITE, r * 0.24f, 0);
  C2D_DrawCircleSolid(cx, cy + r * 0.42f, 0, r * 0.13f, WHITE);
}
static void cross_mark(float cx, float cy, float r, u32 bg) {
  C2D_DrawCircleSolid(cx, cy, 0, r, bg);
  C2D_DrawLine(cx - r * 0.38f, cy - r * 0.38f, WHITE, cx + r * 0.38f, cy + r * 0.38f, WHITE, r * 0.22f, 0);
  C2D_DrawLine(cx + r * 0.38f, cy - r * 0.38f, WHITE, cx - r * 0.38f, cy + r * 0.38f, WHITE, r * 0.22f, 0);
}

typedef struct { float x, y, w, h; } Box;
static bool hit(Box b, touchPosition t) { return t.px >= b.x && t.px < b.x + b.w && t.py >= b.y && t.py < b.y + b.h; }
static void button(Box b, const char *label, u32 fill, u32 ink, bool pressed) {
  rrect(b.x, b.y + (pressed ? 1 : 4), b.w, b.h, b.h / 2, SHADOW);
  rrect(b.x, b.y + (pressed ? 2 : 0), b.w, b.h, b.h / 2, fill);
  text(label, b.x + b.w / 2, b.y + b.h / 2 - 9 + (pressed ? 2 : 0), 0.62f, ink, CENTER, 0);
}

// ---- screens ------------------------------------------------------------------------------------------------------
static char ipText[32];
static bool wifiOk, netOk, pxiOk;
static float anim;
// The saves list (Y): open, waiting to look through the SD card, the selected row and the first row shown.
static bool listOpen, listScan;
static int sel, first;
#define ROWS 4
// A short message from the menu (why something couldn't start), shown for a few seconds.
static char notice[240];
static u64 noticeAt;
static void note(const char *why) { snprintf(notice, sizeof notice, "%s", why); noticeAt = osGetTime(); }
static bool noticing(void) { return notice[0] && osGetTime() - noticeAt < 8000; }

static void when_text(int64_t t, char *out, size_t cap) {
  if (!t) { snprintf(out, cap, "date unknown"); return; }
  time_t tt = (time_t)t; struct tm tm; gmtime_r(&tt, &tm);
  strftime(out, cap, "%b %d %Y, %H:%M", &tm);
}
static const char *file_name(const char *p) { const char *b = strrchr(p, '/'); return b ? b + 1 : p; }

// Top screen while the saves list is open: everything about the selected save.
static void list_details(void) {
  int n; const LLSaveFile *l = ll_sd_list(&n);
  if (listScan) { text("Looking through the SD card", 30, 136, 0.62f, INK, LEFT, 0); return; }
  if (!n) {
    text("No Wild World saves found", 30, 136, 0.62f, INK, LEFT, 0);
    text("Back up your game card with X, or play Wild World through TWiLight Menu++ or a forwarder, and its save shows up here.", 30, 158, 0.46f, MUTED, LEFT, 340);
    return;
  }
  const LLSaveFile *e = &l[sel];
  char line[400], when[40];
  when_text(e->mtime, when, sizeof when);
  text(e->town, 30, 136, 0.62f, INK, LEFT, 0);
  snprintf(line, sizeof line, "%s\n%s %s, %s version\n%s", e->residents[0] ? e->residents : "No residents yet", e->backup ? "Backed up" : "Saved", when, e->region == 0x8A ? "USA" : "European", e->ok ? e->path : "Damaged: it fails the game's own checks, so it can't go on the game card.");
  text(line, 30, 158, 0.42f, e->ok ? MUTED : RED, LEFT, 340);
}

static void top_screen(void) {
  const LLStatus *s = ll_status();
  textMax = 360; textRight = 380;
  C2D_DrawRectangle(0, 0, 0, 400, 240, SKY_TOP, SKY_TOP, SKY_LOW, SKY_LOW);
  // Clouds drift; hills sit at the bottom.
  for (int i = 0; i < 3; i++) {
    float x = fmodf(anim * (6 + i * 3) + i * 150, 480) - 60, y = 26 + i * 18;
    C2D_DrawEllipseSolid(x, y, 0, 46, 14, C2D_Color32(0xFF, 0xFF, 0xFF, 0xB0));
    C2D_DrawEllipseSolid(x + 12, y - 7, 0, 26, 14, C2D_Color32(0xFF, 0xFF, 0xFF, 0xB0));
  }
  C2D_DrawEllipseSolid(-60, 196, 0, 300, 120, GRASS_DARK);
  C2D_DrawEllipseSolid(170, 206, 0, 300, 110, GRASS);

  leaf(34, 26, 34, 11, LEAF, LEAF_LIGHT);
  text("Leaflet Link", 56, 12, 0.8f, INK, LEFT, 0);
  text("for Animal Crossing: Wild World", 57, 34, 0.45f, MUTED, LEFT, 0);

  panel(16, 62, 368, 150, CARD);
  const LLCard *c = ll_card();
  char why[160];
  bool ready = ll_card_ready(why, sizeof why);
  // Cartridge line.
  C2D_DrawCircleSolid(36, 86, 0, 7, ready ? LEAF : c->present ? AMBER : GREY);
  if (ready) {
    char line[96];
    snprintf(line, sizeof line, "Wild World game card (%s) %s", c->code, ll_chip()->writable ? "ready" : "can't be saved to");
    text(line, 50, 76, 0.55f, INK, LEFT, 0);
  } else text(c->present ? "Game card not ready" : "No game card", 50, 76, 0.55f, INK, LEFT, 0);
  // Wi-Fi line.
  C2D_DrawCircleSolid(36, 110, 0, 7, netOk ? LEAF : wifiOk ? AMBER : GREY);
  char net[96];
  if (netOk) snprintf(net, sizeof net, "Wi-Fi connected: %s", ipText);
  else snprintf(net, sizeof net, wifiOk ? "Wi-Fi on, but port %d couldn't open" : "Not connected to Wi-Fi", LL_PORT);
  text(net, 50, 100, 0.55f, INK, LEFT, 0);

  C2D_DrawRectSolid(30, 128, 0, 340, 1, GREY);
  if (listOpen) { list_details(); return; }
  if (s->state == LL_IDLE && noticing()) { text("Not now", 30, 136, 0.62f, INK, LEFT, 0); text(notice, 30, 158, 0.46f, RED, LEFT, 340); return; }
  text(s->title, 30, 136, 0.62f, INK, LEFT, 0);
  const char *body = s->message;
  if (s->state == LL_IDLE && !ready) body = why;
  else if (s->state == LL_IDLE && !netOk) body = wifiOk ? "Restart Leaflet Link. If it keeps happening, restart the 3DS." : "Turn on wireless and connect to the same Wi-Fi network as your computer (System Settings > Internet Settings).";
  if (!pxiOk) body = "Leaflet Link couldn't get access to the game card slot. Start it from the Homebrew Launcher.";
  text(body, 30, 158, 0.46f, MUTED, LEFT, 340);
}

static Box btnA = { 24, 172, 168, 44 }, btnB = { 204, 172, 92, 44 }, btnOK = { 96, 176, 128, 40 };
// The menu (X, Y, R) and the saves list.
static Box btnX = { 14, 144, 94, 46 }, btnY = { 113, 144, 94, 46 }, btnR = { 212, 144, 94, 46 };
static Box btnPut = { 14, 196, 190, 36 }, btnBack = { 212, 196, 94, 36 }, btnStop = { 110, 172, 100, 40 };
static Box row_box(int i) { return (Box){ 14, 34 + i * 40, 292, 38 }; }

static void saves_list(bool touching, touchPosition tp) {
  int n; const LLSaveFile *l = ll_sd_list(&n);
  text("Saves on the SD card", 160, 8, 0.55f, INK, CENTER, 0);
  if (listScan) { C2D_DrawCircleSolid(160, 110, 0, 6 + 3 * sinf(anim * 6), LEAF); text("Looking\xE2\x80\xA6", 160, 126, 0.5f, MUTED, CENTER, 0); }
  else if (!n) { panel(14, 34, 292, 150, CARD); text("Nothing here yet.", 160, 90, 0.6f, MUTED, CENTER, 0); }
  for (int i = 0; !listScan && i < ROWS && first + i < n; i++) {
    const LLSaveFile *e = &l[first + i];
    Box b = row_box(i);
    bool on = first + i == sel;
    rrect(b.x, b.y, b.w, b.h, 9, on ? C2D_Color32(0xEE, 0xF8, 0xE6, 0xFF) : CARD);
    if (on) { rrect(b.x, b.y, 5, b.h, 2, LEAF); }
    char when[40], line[240];
    when_text(e->mtime, when, sizeof when);
    float keep = textRight; textRight = 298;
    text(e->town, b.x + 14, b.y + 3, 0.52f, e->ok ? INK : RED, LEFT, 0);
    snprintf(line, sizeof line, "%s \xC2\xB7 %.150s", when, e->backup ? "Leaflet Link backup" : file_name(e->path));
    text(line, b.x + 14, b.y + 21, 0.38f, MUTED, LEFT, 0);
    textRight = keep;
  }
  if (n > ROWS) { float h = 156.0f * ROWS / n, y = 34 + 156.0f * first / n; rrect(308, y, 4, h, 2, GREY); }
  bool can = !listScan && n && l[sel].ok;
  button(btnPut, "\xEE\x80\x80 Put on game card", can ? LEAF : GREY, can ? WHITE : MUTED, touching && hit(btnPut, tp));
  button(btnBack, "\xEE\x80\x81 Back", GREY, INK, touching && hit(btnBack, tp));
}

static void steps(int at) {
  const char *names[3] = { "Copy", "Save", "Check" };
  for (int i = 0; i < 3; i++) {
    float x = 70 + i * 90;
    if (i) C2D_DrawRectSolid(x - 90 + 12, 107, 0, 66, 3, i <= at ? LEAF : GREY);
    if (i < at) tick_mark(x, 108, 11, LEAF);
    else { C2D_DrawCircleSolid(x, 108, 0, 11, i == at ? LEAF : GREY); if (i == at) C2D_DrawCircleSolid(x, 108, 0, 4 + 2 * sinf(anim * 6), WHITE); }
    text(names[i], x, 124, 0.45f, i <= at ? INK : MUTED, CENTER, 0);
  }
}

static void bottom_screen(bool touching, touchPosition tp) {
  const LLStatus *s = ll_status();
  textMax = 276; textRight = 298;
  C2D_DrawRectSolid(0, 0, 0, 320, 240, PAPER);
  for (int y = 0; y < 240; y += 16) C2D_DrawRectSolid(0, y, 0, 320, 8, STRIPE);
  char line[320];
  switch (s->state) {
    case LL_CONFIRM: if (s->update) {
      panel(14, 12, 292, 146, CARD);
      leaf(160, 38, 30, 10, LEAF, LEAF_LIGHT);
      text("Update Leaflet Link?", 160, 56, 0.55f, MUTED, CENTER, 0);
      snprintf(line, sizeof line, "%s \xE2\x86\x92 %s", LL_VERSION, s->version);
      text(line, 160, 76, 1.0f, INK, CENTER, 0);
      snprintf(line, sizeof line, "Sent by Leaflet on %s", s->peer);
      text(line, 160, 128, 0.42f, MUTED, CENTER, 0);
      button(btnA, "\xEE\x80\x80 Update", LEAF, WHITE, touching && hit(btnA, tp));
      button(btnB, "\xEE\x80\x81 Cancel", GREY, INK, touching && hit(btnB, tp));
      break;
    } else {
      panel(14, 12, 292, 146, CARD);
      leaf(160, 38, 30, 10, LEAF, LEAF_LIGHT);
      text(s->kind == LL_JOB_SDFILE ? "Save this town to the SD card?" : s->source[0] ? "Put this town on your game card?" : "Save this town to your game card?", 160, 56, 0.55f, MUTED, CENTER, 0);
      text(s->town, 160, 76, 1.0f, INK, CENTER, 0);
      if (s->residents[0]) text(s->residents, 160, 106, 0.48f, MUTED, CENTER, 0);
      if (s->kind == LL_JOB_SDFILE) snprintf(line, sizeof line, "Into %s, from Leaflet on %s", file_name(s->target), s->peer);
      else if (s->source[0]) snprintf(line, sizeof line, "From %s", s->source);
      else snprintf(line, sizeof line, "Sent by Leaflet on %s", s->peer);
      text(line, 160, 128, 0.42f, MUTED, CENTER, 0);
      button(btnA, "\xEE\x80\x80 Save", LEAF, WHITE, touching && hit(btnA, tp));
      button(btnB, "\xEE\x80\x81 Cancel", GREY, INK, touching && hit(btnB, tp));
      break;
    }
    case LL_UPDATING:
      panel(14, 12, 292, 120, CARD);
      text(s->title, 160, 34, 0.8f, INK, CENTER, 0);
      C2D_DrawCircleSolid(160, 90, 0, 6 + 3 * sinf(anim * 6), LEAF);
      break;
    case LL_CHECKING: {
      panel(14, 12, 292, 150, CARD);
      text(s->title, 160, 26, 0.75f, INK, CENTER, 0);
      text("Reading the save chip again and again to make sure it reads the same every time. Nothing is written.", 30, 54, 0.42f, MUTED, LEFT, 260);
      rrect(34, 112, 252, 16, 8, GREY);
      rrect(34, 112, fmaxf(16, 252 * s->progress), 16, 8, LEAF);
      snprintf(line, sizeof line, "Read %d of 6", (int)(s->progress * 6) + 1 > 6 ? 6 : (int)(s->progress * 6) + 1);
      text(line, 160, 136, 0.45f, MUTED, CENTER, 0);
      button(btnStop, "\xEE\x80\x81 Stop", GREY, INK, touching && hit(btnStop, tp));
      break;
    }
    case LL_BACKUP: case LL_WRITING: case LL_VERIFYING: case LL_RESTORING: if (s->kind == LL_JOB_BACKUP) {
      panel(14, 12, 292, 120, CARD);
      text(s->title, 160, 34, 0.8f, INK, CENTER, 0);
      C2D_DrawCircleSolid(160, 90, 0, 6 + 3 * sinf(anim * 6), LEAF);
      break;
    } else {
      panel(14, 12, 292, 216, CARD);
      text(s->title, 160, 26, 0.8f, INK, CENTER, 0);
      if (s->state == LL_RESTORING) text("Something went wrong, so your original save is going back on.", 30, 56, 0.45f, RED, LEFT, 260);
      else text(s->kind == LL_JOB_SDFILE ? "Don't turn off the power or take out the SD card." : "Don't turn off the power or take out the game card.", 30, 52, 0.45f, MUTED, LEFT, 260);
      steps(s->state == LL_BACKUP ? 0 : s->state == LL_WRITING || s->state == LL_RESTORING ? 1 : 2);
      float p = s->state == LL_BACKUP ? 0.05f : s->state == LL_VERIFYING ? 0.92f : 0.08f + 0.8f * s->progress;
      rrect(34, 160, 252, 16, 8, GREY);
      rrect(34, 160, fmaxf(16, 252 * p), 16, 8, s->state == LL_RESTORING ? AMBER : LEAF);
      if (s->state == LL_WRITING) { snprintf(line, sizeof line, "%d of %d changed pages", s->written, s->changed); text(line, 160, 186, 0.45f, MUTED, CENTER, 0); }
      break;
    }
    case LL_DONE: case LL_FAILED: {
      panel(14, 12, 292, 150, CARD);
      bool good = s->state == LL_DONE;
      if (good && s->caution) bang_mark(160, 44, 20, AMBER); else if (good) tick_mark(160, 44, 20, LEAF); else if (s->restored) tick_mark(160, 44, 20, AMBER); else cross_mark(160, 44, 20, RED);
      text(s->title, 160, 70, 0.75f, INK, CENTER, 0);
      text(s->message, 28, 96, 0.4f, MUTED, LEFT, 264);
      button(btnOK, s->quit ? "\xEE\x80\x80 Close" : "\xEE\x80\x80 OK", good ? LEAF : GREY, good ? WHITE : INK, touching && hit(btnOK, tp));
      break;
    }
    default: {
      if (listOpen) { saves_list(touching, tp); break; }
      panel(14, 10, 292, 124, CARD);
      if (netOk) {
        text("On your computer, open Leaflet,", 160, 18, 0.48f, MUTED, CENTER, 0);
        text("choose Cartridge Sync and type:", 160, 34, 0.48f, MUTED, CENTER, 0);
        rrect(34, 56, 252, 46, 14, C2D_Color32(0xEE, 0xF8, 0xE6, 0xFF));
        text(ipText, 160, 63, 1.0f, LEAF, CENTER, 0);
        text("Saves are only written after you press \xEE\x80\x80 here.", 160, 110, 0.42f, MUTED, CENTER, 0);
      } else {
        text("Waiting for Wi-Fi", 160, 30, 0.75f, INK, CENTER, 0);
        text("To use Leaflet, connect the 3DS to the same network as your computer. The buttons below work without it.", 30, 62, 0.42f, MUTED, LEFT, 260);
      }
      char why[8];
      bool ready = ll_card_ready(why, sizeof why) && ll_chip()->writable;
      button(btnX, "\xEE\x80\x82 Back up", ready ? LEAF : GREY, ready ? WHITE : MUTED, touching && hit(btnX, tp));
      button(btnY, "\xEE\x80\x83 Saves", WHITE, INK, touching && hit(btnY, tp));
      button(btnR, "\xEE\x80\x85 Check", ready ? WHITE : GREY, ready ? INK : MUTED, touching && hit(btnR, tp));
      text("START: quit", 160, 212, 0.42f, MUTED, CENTER, 0);
    }
  }
}

// ---- main ---------------------------------------------------------------------------------------------------------
static void refresh_network(void) {
  u32 status = 0;
  wifiOk = R_SUCCEEDED(ACU_GetWifiStatus(&status)) && status != 0;
  u32 ip = wifiOk ? (u32)gethostid() : 0;
  struct in_addr a = { .s_addr = ip };
  snprintf(ipText, sizeof ipText, "%s", ip ? inet_ntoa(a) : "");
}

int main(int argc, char **argv) {
  if (argc > 0 && argv[0] && !strncmp(argv[0], "sdmc:/", 6) && strstr(argv[0], ".3dsx")) snprintf(appPath, sizeof appPath, "%s", argv[0]);
  gfxInitDefault();
  C3D_Init(C3D_DEFAULT_CMDBUF_SIZE);
  C2D_Init(C2D_DEFAULT_MAX_OBJECTS * 2);
  C2D_Prepare();
  C3D_RenderTarget *top = C2D_CreateScreenTarget(GFX_TOP, GFX_LEFT);
  C3D_RenderTarget *bot = C2D_CreateScreenTarget(GFX_BOTTOM, GFX_LEFT);
  tbuf = C2D_TextBufNew(8192);
  acInit(); ptmuInit();
  pxiOk = R_SUCCEEDED(pxiDevInit());
  u32 *socBuf = memalign(SOC_ALIGN, SOC_SIZE);
  bool socOk = socBuf && R_SUCCEEDED(socInit(socBuf, SOC_SIZE));

  ll_init();
  netOk = socOk && ll_net_start();
  refresh_network();
  u64 lastNet = osGetTime();

  while (aptMainLoop()) {
    hidScanInput();
    u32 down = hidKeysDown(), held = hidKeysHeld(), up = hidKeysUp();
    touchPosition tp; hidTouchRead(&tp);
    static touchPosition lastTouch;
    bool touching = held & KEY_TOUCH;
    if (touching) lastTouch = tp;
    const LLStatus *s = ll_status();
    // A press acts only on the screen it was made on: what's on screen now. (Picking a save from the list puts a
    // confirmation up; the same A must not also answer it.)
    const LLState now = s->state;
    bool busy = now == LL_BACKUP || now == LL_WRITING || now == LL_VERIFYING || now == LL_RESTORING || now == LL_UPDATING;

    bool tapped = (up & KEY_TOUCH) != 0;
    if ((down & KEY_START) && !busy && now != LL_CONFIRM && now != LL_CHECKING) break;
    char why[240];
    if (now == LL_IDLE && listOpen) {
      int n; const LLSaveFile *l = ll_sd_list(&n);
      if (listScan) { /* drawn once, then looked through below */ }
      else if ((down & KEY_B) || (tapped && hit(btnBack, lastTouch))) listOpen = false;
      else {
        if ((down & KEY_DOWN) && sel + 1 < n) sel++;
        if ((down & KEY_UP) && sel > 0) sel--;
        bool pick = (down & KEY_A) || (tapped && hit(btnPut, lastTouch));
        for (int i = 0; tapped && i < ROWS && first + i < n; i++) if (hit(row_box(i), lastTouch)) { pick = sel == first + i; sel = first + i; }
        if (sel < first) first = sel;
        if (sel >= first + ROWS) first = sel - ROWS + 1;
        if (pick && n && l[sel].ok) { if (ll_restore_from_sd(sel, why, sizeof why)) listOpen = false; else { listOpen = false; note(why); } }
      }
    } else if (now == LL_IDLE) {
      if ((down & KEY_X) || (tapped && hit(btnX, lastTouch))) { if (!ll_start_backup(why, sizeof why)) note(why); }
      else if ((down & KEY_R) || (tapped && hit(btnR, lastTouch))) { if (!ll_start_health(why, sizeof why)) note(why); }
      else if ((down & KEY_Y) || (tapped && hit(btnY, lastTouch))) { listOpen = listScan = true; sel = first = 0; notice[0] = 0; }
    } else if (now == LL_CHECKING) {
      if ((down & KEY_B) || (tapped && hit(btnStop, lastTouch))) ll_answer(false);
    } else if (now == LL_CONFIRM) {
      if ((down & KEY_A) || (tapped && hit(btnA, lastTouch))) ll_answer(true);
      else if ((down & KEY_B) || (tapped && hit(btnB, lastTouch))) ll_answer(false);
    } else if (now == LL_DONE || now == LL_FAILED) {
      if ((down & KEY_A) || (tapped && hit(btnOK, lastTouch))) { if (s->quit) break; ll_answer(true); }
    }
    if (s->state != LL_IDLE) listOpen = false;

    if (pxiOk) { ll_net_poll(); ll_tick(); }
    if (osGetTime() - lastNet > 2000) {
      refresh_network(); lastNet = osGetTime();
      if (socOk && !netOk && wifiOk) netOk = ll_net_start();
    }

    anim += 1 / 60.0f;
    C2D_TextBufClear(tbuf);
    C3D_FrameBegin(C3D_FRAME_SYNCDRAW);
    C2D_TargetClear(top, SKY_TOP);
    C2D_SceneBegin(top);
    top_screen();
    C2D_TargetClear(bot, PAPER);
    C2D_SceneBegin(bot);
    bottom_screen(touching, tp);
    C3D_FrameEnd(0);
    // Looking through the SD card takes a moment, so it starts after the "Looking" screen has been drawn once.
    if (listScan) { ll_sd_scan(); listScan = false; }
  }

  plat_hold(false);
  ll_net_stop();
  if (socOk) socExit();
  pxiDevExit(); ptmuExit(); acExit();
  C2D_TextBufDelete(tbuf);
  C2D_Fini(); C3D_Fini(); gfxExit();
  return 0;
}
