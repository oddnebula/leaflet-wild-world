// Leaflet Link core. See core.h.
//
// Safety rules for writing a cartridge, in order:
//  1. The save from Leaflet must be exactly 256 KB, arrive with the CRC-32 Leaflet computed, and pass every checksum
//     the game checks (both copies of the town and the town hall letters).
//  2. Nothing is written until the person presses A on the console, which shows the town's name first.
//  3. The cartridge must still be Wild World, its save chip must be the 256 KB flash the game uses, the battery must
//     not be low, and a save already on it must be from the same region (USA and European saves differ).
//  4. What's on the cartridge is read twice until two reads agree, and kept on the SD card. The file is read back and
//     compared before anything is written.
//  5. Only 256-byte pages that differ are written, lowest address first. Each page is read back after it's written.
//     Lowest-first means the game's first copy of the town is complete before its second copy changes, so if power is
//     lost part way the game still finds one healthy copy.
//  6. When every page is written, the whole cartridge is read back and compared byte for byte (twice).
//  7. If any of that fails, the original save is written back and checked the same way, and the console and Leaflet
//     say exactly what happened. The copy on the SD card stays either way.
#include "core.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>

// ---- save layout (matches js/save.js) -----------------------------------------------------------------------------
#define BLOCK 0x15FE0
#define COPY2 0x15FE0
#define LETTERS 0x2E20C
#define LETTERS_SIZE 0x11DF4

static uint16_t sum16(const uint8_t *d, size_t off, size_t len) {
  uint32_t s = 0;
  for (size_t i = 0; i < len; i += 2) s += d[off + i] | (d[off + i + 1] << 8);
  return (uint16_t)s;
}

static void say(char *out, size_t cap, const char *fmt, ...) {
  va_list ap; va_start(ap, fmt); vsnprintf(out, cap, fmt, ap); va_end(ap);
}

uint32_t ll_crc32(const uint8_t *d, size_t n) {
  static uint32_t table[256];
  if (!table[1]) for (uint32_t i = 0; i < 256; i++) {
    uint32_t c = i;
    for (int k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320u ^ (c >> 1) : c >> 1;
    table[i] = c;
  }
  uint32_t c = 0xFFFFFFFFu;
  for (size_t i = 0; i < n; i++) c = table[(c ^ d[i]) & 0xFF] ^ (c >> 8);
  return c ^ 0xFFFFFFFFu;
}

bool ll_save_blank(const uint8_t *d) {
  for (size_t i = 0; i < LL_SAVE_SIZE; i++) if (d[i] != 0xFF) return false;
  return true;
}

static bool copy_ok(const uint8_t *d, size_t at) { return (d[at] == 0x8A || d[at] == 0xC5) && sum16(d, at, BLOCK) == 0; }

int ll_save_region(const uint8_t *d) {
  if (copy_ok(d, COPY2)) return d[COPY2];
  if (copy_ok(d, 0)) return d[0];
  return 0;
}

int ll_check_save(const uint8_t *d, char *why, size_t cap) {
  if (d[0] == 0x32 || d[COPY2] == 0x32) { say(why, cap, "This is a Japanese or Korean save. Leaflet Link only writes USA and European saves."); return 1; }
  if (!copy_ok(d, 0)) { say(why, cap, "The first copy of the town failed its checksum."); return 2; }
  if (!copy_ok(d, COPY2)) { say(why, cap, "The second copy of the town failed its checksum."); return 3; }
  if (d[0] != d[COPY2]) { say(why, cap, "The two copies of the town are from different regions."); return 4; }
  if (sum16(d, LETTERS, LETTERS_SIZE) != 0) { say(why, cap, "The town hall letters failed their checksum."); return 5; }
  return 0;
}

// ---- DS save chip -------------------------------------------------------------------------------------------------
// Standard SPI flash commands used by DS game cards (documented in GBATEK's "DS Cartridge Backup" section).
enum { CMD_WREN = 0x06, CMD_RDSR = 0x05, CMD_READ = 0x03, CMD_PP = 0x02, CMD_PW = 0x0A, CMD_PE = 0xDB, CMD_SE = 0xD8, CMD_RDID = 0x9F };
#define READ_CHUNK 0x400
#define SECTOR 0x10000

static LLChip chip;
// 0 page write, 1 page erase + program, 2 sector erase + program. The first page written finds the method this chip
// takes; after that a page that won't write is a fault, never a reason to try a heavier method (a sector erase on a
// failing chip could damage pages that were fine).
static int method;
static bool methodKnown;

static bool chip_status(uint8_t *sr) { uint8_t c = CMD_RDSR; return plat_spi(&c, 1, sr, 1, NULL, 0); }
static bool chip_wait(uint32_t ms) {
  uint64_t end = plat_ms() + ms;
  uint8_t sr = 0xFF;
  do { if (!chip_status(&sr)) return false; if (!(sr & 1)) return true; } while (plat_ms() < end);
  return false;
}
static bool chip_read(uint32_t a, uint8_t *out, size_t n) {
  for (size_t o = 0; o < n; o += READ_CHUNK) {
    uint32_t at = a + (uint32_t)o;
    size_t k = n - o < READ_CHUNK ? n - o : READ_CHUNK;
    uint8_t c[4] = { CMD_READ, (uint8_t)(at >> 16), (uint8_t)(at >> 8), (uint8_t)at };
    if (!plat_spi(c, 4, out + o, k, NULL, 0)) return false;
  }
  return true;
}
static bool chip_op(uint8_t op, uint32_t a, const uint8_t *data, size_t n, uint32_t ms) {
  uint8_t w = CMD_WREN;
  if (!plat_spi(&w, 1, NULL, 0, NULL, 0)) return false;
  uint8_t c[4] = { op, (uint8_t)(a >> 16), (uint8_t)(a >> 8), (uint8_t)a };
  if (!plat_spi(c, 4, NULL, 0, data, n)) return false;
  return chip_wait(ms);
}
static bool page_is(uint32_t a, const uint8_t *want) {
  uint8_t got[LL_PAGE];
  return chip_read(a, got, LL_PAGE) && memcmp(got, want, LL_PAGE) == 0;
}

static void chip_detect(void) {
  memset(&chip, 0, sizeof chip);
  uint8_t c = CMD_RDID;
  if (!plat_spi(&c, 1, chip.id, 3, NULL, 0)) { say(chip.why, sizeof chip.why, "The console couldn't reach the game card's save chip."); return; }
  bool ff = chip.id[0] == 0xFF && chip.id[1] == 0xFF && chip.id[2] == 0xFF, zero = !chip.id[0] && !chip.id[1] && !chip.id[2];
  if (ff || zero) { say(chip.why, sizeof chip.why, "The save chip didn't identify itself, so it isn't the flash chip Wild World uses."); return; }
  chip.answered = true;
  if (chip.id[2] >= 0x10 && chip.id[2] <= 0x17) chip.size = 1u << chip.id[2];
  if (chip.size != LL_SAVE_SIZE) { say(chip.why, sizeof chip.why, "This save chip holds %u KB; Wild World's holds 256 KB.", (unsigned)(chip.size / 1024)); return; }
  chip.writable = true;
}

// Erases a 64 KB sector and programs all of it from target, then checks it. Only used when a chip takes neither
// page command.
static bool write_sector(uint32_t a, const uint8_t *target) {
  uint32_t s = a & ~(uint32_t)(SECTOR - 1);
  if (!chip_op(CMD_SE, s, NULL, 0, 6000)) return false;
  for (uint32_t p = s; p < s + SECTOR; p += LL_PAGE) if (!chip_op(CMD_PP, p, target + p, LL_PAGE, 100)) return false;
  for (uint32_t p = s; p < s + SECTOR; p += LL_PAGE) if (!page_is(p, target + p)) return false;
  return true;
}
// Makes one page match target, trying each write method in turn. True once the page reads back exactly.
static bool write_page(uint32_t a, const uint8_t *target) {
  for (int m = methodKnown ? method : 0; m < (methodKnown ? method + 1 : 3); m++) {
    for (int tries = 0; tries < (methodKnown ? 3 : 2); tries++) {
      bool ok;
      if (m == 0) ok = chip_op(CMD_PW, a, target + a, LL_PAGE, 100);
      else if (m == 1) ok = chip_op(CMD_PE, a, NULL, 0, 100) && chip_op(CMD_PP, a, target + a, LL_PAGE, 100);
      else ok = write_sector(a, target);
      if (ok && page_is(a, target + a)) { method = m; methodKnown = true; return true; }
    }
  }
  return false;
}

// ---- jobs ---------------------------------------------------------------------------------------------------------
static LLStatus st;
static LLCard card;
static uint64_t cardSeen;
static uint8_t *incoming, *original, *scratch, *scratch2, *app;
static size_t appLen;
static uint16_t todo[LL_PAGES];
static int todoN, todoAt, verifyPasses;
static bool restoring, checking;   // putting the original back / reading back after writing
static char jobCode[5], reason[240];

const LLStatus *ll_status(void) { return &st; }
const LLCard *ll_card(void) { return &card; }
const LLChip *ll_chip(void) { return &chip; }

static void set_state(LLState s, const char *title, const char *fmt, ...) {
  st.state = s; st.since = plat_ms(); st.progress = 0;
  snprintf(st.title, sizeof st.title, "%s", title);
  va_list ap; va_start(ap, fmt); vsnprintf(st.message, sizeof st.message, fmt, ap); va_end(ap);
  plat_hold(s == LL_BACKUP || s == LL_WRITING || s == LL_VERIFYING || s == LL_RESTORING || s == LL_UPDATING);
}

static void refresh_card(bool force) {
  if (!force && plat_ms() - cardSeen < 500) return;
  cardSeen = plat_ms();
  LLCard now; plat_card(&now);
  bool changed = now.present != card.present || strcmp(now.code, card.code) != 0;
  card = now;
  if (changed) { if (card.present && card.ds) chip_detect(); else memset(&chip, 0, sizeof chip); method = 0; methodKnown = false; }
}

bool ll_card_ready(char *why, size_t cap) {
  if (!card.present) { say(why, cap, "Put your Animal Crossing: Wild World game card in the 3DS."); return false; }
  if (!card.ds) { say(why, cap, "That's a 3DS game card. Leaflet Link needs the Wild World DS game card."); return false; }
  if (strncmp(card.code, "ADM", 3) != 0) { say(why, cap, "That isn't Animal Crossing: Wild World (this card is %s, %s).", card.title, card.code); return false; }
  if (!chip.answered) { say(why, cap, "%s", chip.why[0] ? chip.why : "The game card's save chip didn't answer. Take the card out and put it back in."); return false; }
  return true;
}

// Reads the whole save, each 4 KB chunk until two reads of it in a row agree (a dirty contact can flip a bit now and
// then; it never flips the same one twice). dst gets the agreed copy.
static bool read_stable(uint8_t *dst) {
  for (uint32_t a = 0; a < LL_SAVE_SIZE; a += 0x1000) {
    if (!chip_read(a, dst + a, 0x1000)) return false;
    int tries = 0;
    for (;;) {
      if (!chip_read(a, scratch2, 0x1000)) return false;
      if (!memcmp(dst + a, scratch2, 0x1000)) break;
      if (++tries == 8) return false;
      memcpy(dst + a, scratch2, 0x1000);
    }
  }
  return true;
}

void ll_init(void) {
  incoming = malloc(LL_SAVE_SIZE); original = malloc(LL_SAVE_SIZE); scratch = malloc(LL_SAVE_SIZE); scratch2 = malloc(LL_SAVE_SIZE);
  set_state(LL_IDLE, "Ready", "Waiting for Leaflet.");
  refresh_card(true);
}

// A save arrived from Leaflet. Returns 0 and waits for the person, or an HTTP status with the reason in why.
static int stage(const uint8_t *body, size_t n, uint32_t crc, const char *town, const char *residents, uint32_t job, const char *peer, char *why, size_t cap) {
  if (st.state != LL_IDLE && st.state != LL_DONE && st.state != LL_FAILED) { say(why, cap, "Leaflet Link is busy with another save. Finish that one on the 3DS first."); return 409; }
  if (n != LL_SAVE_SIZE) { say(why, cap, "The save must be exactly 256 KB (got %u bytes).", (unsigned)n); return 400; }
  if (ll_crc32(body, n) != crc) { say(why, cap, "The save was damaged on its way over Wi-Fi (its CRC didn't match). Nothing was written; send it again."); return 400; }
  if (ll_check_save(body, why, cap)) return 422;
  refresh_card(true);
  if (!ll_card_ready(why, cap)) return 409;
  if (!chip.writable) { say(why, cap, "%s", chip.why); return 409; }
  memcpy(incoming, body, n);
  memcpy(jobCode, card.code, sizeof jobCode);
  snprintf(st.town, sizeof st.town, "%s", town[0] ? town : "your town");
  snprintf(st.residents, sizeof st.residents, "%s", residents);
  snprintf(st.peer, sizeof st.peer, "%s", peer);
  st.job = job; st.changed = st.written = 0; st.restored = st.update = st.quit = false; st.backup[0] = st.version[0] = 0;
  set_state(LL_CONFIRM, "Save to your game card?", "Leaflet on %s wants to save %s to this game card. Press A to save it, or B to cancel.", peer, st.town);
  return 0;
}

// A new Leaflet Link arrived from Leaflet. Same rules as a save: checked first, then the person decides.
static int stage_update(const uint8_t *body, size_t n, uint32_t crc, const char *version, uint32_t job, const char *peer, char *why, size_t cap) {
  if (st.state != LL_IDLE && st.state != LL_DONE && st.state != LL_FAILED) { say(why, cap, "Leaflet Link is busy. Finish on the 3DS first."); return 409; }
  if (n < 0x1000 || n > LL_APP_MAX || memcmp(body, "3DSX", 4)) { say(why, cap, "That isn't a 3DS homebrew app (.3dsx)."); return 400; }
  if (ll_crc32(body, n) != crc) { say(why, cap, "The update was damaged on its way over Wi-Fi (its CRC didn't match). Nothing was changed; try again."); return 400; }
  if (!app) app = malloc(LL_APP_MAX);
  if (!app) { say(why, cap, "Not enough memory for the update."); return 500; }
  memcpy(app, body, n); appLen = n;
  snprintf(st.version, sizeof st.version, "%s", version[0] ? version : "?");
  snprintf(st.peer, sizeof st.peer, "%s", peer);
  st.job = job; st.update = true; st.quit = false; st.restored = false; st.backup[0] = 0; st.town[0] = st.residents[0] = 0;
  set_state(LL_CONFIRM, "Update Leaflet Link?", "Leaflet on %s wants to update Leaflet Link from %s to %s. Press A to update, or B to cancel.", peer, LL_VERSION, st.version);
  return 0;
}

static void step_update(void) {
  char why[200];
  if (plat_install_app(app, appLen, why, sizeof why)) {
    st.quit = true;
    set_state(LL_DONE, "Updated!", "Leaflet Link %s is installed. Press A to close this version, then open Leaflet Link again from the Homebrew Launcher.", st.version);
  } else set_state(LL_FAILED, "Not updated", "%s This version of Leaflet Link is still installed and works as before.", why);
}

static void list_differences(const uint8_t *target) {
  todoN = todoAt = 0;
  for (int p = 0; p < LL_PAGES; p++) if (memcmp(scratch + p * LL_PAGE, target + p * LL_PAGE, LL_PAGE)) todo[todoN++] = (uint16_t)p;
}

static void fail(const char *fmt, ...) {
  char why[240];
  va_list ap; va_start(ap, fmt); vsnprintf(why, sizeof why, fmt, ap); va_end(ap);
  if (restoring) {
    set_state(LL_FAILED, "Couldn't restore", "%s Putting the original back failed too: %s Your game card may not load. The save that was on it is on the SD card at %s; open it in Leaflet and send it again.", reason, why, st.backup);
    return;
  }
  if (st.state == LL_WRITING || st.state == LL_VERIFYING) {
    // Put the original back, checked the same way.
    snprintf(reason, sizeof reason, "%s", why);
    restoring = true; checking = false; verifyPasses = 0;
    if (!chip_read(0, scratch, LL_SAVE_SIZE)) memset(scratch, 0, LL_SAVE_SIZE);   // unreadable: rewrite every page that differs from the original
    list_differences(original);
    set_state(LL_RESTORING, "Putting your save back", "%s Putting the original save back on the game card.", why);
    return;
  }
  set_state(LL_FAILED, "Nothing was changed", "%s Nothing was written; your game card is exactly as it was.", why);
}

// The same game card the job started with is still in the slot.
static bool card_still_there(void) {
  refresh_card(true);
  return card.present && card.ds && !strcmp(jobCode, card.code);
}

static void step_backup(void) {
  char why[160];
  if (!card_still_there() || !ll_card_ready(why, sizeof why)) { fail("The game card was taken out."); return; }
  if (!plat_power_ok(why, sizeof why)) { fail("%s", why); return; }
  if (!read_stable(original)) { fail("The game card couldn't be read reliably (two reads never agreed). Clean the game card's contacts and try again."); return; }
  // A blank or damaged save on the cartridge is still kept on the SD card; replacing it is what the person asked for.
  int was = ll_save_region(original), now = ll_save_region(incoming);
  if (was && was != now) { fail("This game card has a %s save, but the one from Leaflet is from %s. The two versions of the game can't read each other's saves.", was == 0x8A ? "USA" : "European", now == 0x8A ? "the USA" : "Europe"); return; }
  char stamp[40], name[96];
  plat_stamp(stamp, sizeof stamp);
  snprintf(name, sizeof name, "%s %s before Leaflet.sav", stamp, card.code);
  if (!plat_save_backup(name, original, LL_SAVE_SIZE, st.backup, sizeof st.backup)) { fail("The copy of your game card's save couldn't be written to the SD card (is it full or locked?)."); return; }
  memcpy(scratch, original, LL_SAVE_SIZE);
  list_differences(incoming);
  st.changed = todoN; st.written = 0; restoring = checking = false; verifyPasses = 0;
  if (!todoN) { set_state(LL_DONE, "Already up to date", "The game card already has exactly this save. Nothing needed writing."); return; }
  set_state(LL_WRITING, "Saving to the game card", "Writing %d of %d pages that changed. Keep the 3DS on and the game card in.", todoN, LL_PAGES);
}

static void step_write(void) {
  const uint8_t *target = restoring ? original : incoming;
  if (!card_still_there()) {
    set_state(LL_FAILED, "Game card removed", "The game card was taken out while saving, so it may not load. Put it back in and send the save again; what was on it before is on the SD card at %s.", st.backup);
    return;
  }
  uint64_t until = plat_ms() + 20;   // a slice per frame keeps the screen and Wi-Fi responsive
  while (todoAt < todoN && plat_ms() < until) {
    uint32_t a = (uint32_t)todo[todoAt] * LL_PAGE;
    if (!page_is(a, target + a) && !write_page(a, target)) {
      fail("The game card wouldn't keep a change at 0x%05X, even after trying again.", (unsigned)a);
      return;
    }
    todoAt++; if (!restoring) st.written = todoAt;
  }
  st.progress = todoN ? (float)todoAt / todoN : 1;
  if (todoAt < todoN) return;
  if (restoring) { checking = true; snprintf(st.title, sizeof st.title, "Checking your save"); }
  else set_state(LL_VERIFYING, "Checking", "Reading the whole game card back to compare it byte by byte.");
}

static void step_verify(void) {
  const uint8_t *target = restoring ? original : incoming;
  if (!card_still_there()) { set_state(LL_FAILED, "Game card removed", "The game card was taken out before it could be checked. Put it back in and send the save again; what was on it before is on the SD card at %s.", st.backup); return; }
  if (!read_stable(scratch)) { fail("The game card couldn't be read back reliably."); return; }
  list_differences(target);
  if (!todoN) {
    if (restoring) { st.restored = true; set_state(LL_FAILED, "Your save is safe", "%s The original save is back on the game card and checked byte for byte. A copy is also on the SD card at %s.", reason, st.backup); }
    else set_state(LL_DONE, "Saved!", "%s is on your game card. All 262,144 bytes were read back and match what Leaflet sent. The previous save is on the SD card at %s.", st.town, st.backup);
    return;
  }
  if (++verifyPasses > 2) { fail(restoring ? "The original save wouldn't read back correctly." : "%d pages still read back wrong after writing them again.", todoN); return; }
  // Write the pages that didn't match, then check again.
  if (restoring) checking = false; else st.state = LL_WRITING;
}

void ll_tick(void) {
  refresh_card(false);
  switch (st.state) {
    case LL_CONFIRM:
      if (plat_ms() - st.since > 120000) set_state(LL_IDLE, "Ready", "The save from Leaflet wasn't confirmed within two minutes, so it was set aside. Nothing was written.");
      else if (!card.present) set_state(LL_IDLE, "Ready", "The game card was taken out, so the save from Leaflet was set aside. Nothing was written.");
      break;
    case LL_BACKUP: step_backup(); break;
    case LL_WRITING: step_write(); break;
    case LL_VERIFYING: step_verify(); break;
    case LL_RESTORING: if (checking) step_verify(); else step_write(); break;
    case LL_UPDATING: step_update(); break;
    default: break;
  }
}

void ll_answer(bool yes) {
  if (st.state == LL_CONFIRM) {
    if (yes && st.update) set_state(LL_UPDATING, "Updating", "Installing Leaflet Link %s.", st.version);
    else if (yes) set_state(LL_BACKUP, "Keeping a copy", "Reading what's on the game card now and keeping a copy on the SD card.");
    else set_state(LL_IDLE, "Cancelled", "You cancelled on the 3DS. Nothing was written.");
  } else if (st.state == LL_DONE || st.state == LL_FAILED) {
    set_state(LL_IDLE, "Ready", "Waiting for Leaflet.");
  }
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------
// One connection at a time, every socket non-blocking, so the console's screen keeps drawing while data moves.
#define REQ_CAP (LL_APP_MAX + 0x2000)
#define OUT_CAP (LL_SAVE_SIZE + 0x1000)
static int lsock = -1;
static struct { int fd; uint8_t *in; size_t inLen, need, hdrEnd; uint8_t *out; size_t outLen, sent; uint64_t t, closing; char ip[48]; } conn = { .fd = -1 };

bool ll_net_start(void) {
  if (lsock >= 0) return true;
  if (!conn.in) conn.in = malloc(REQ_CAP);
  if (!conn.out) conn.out = malloc(OUT_CAP);
  if (!conn.in || !conn.out) return false;
  lsock = socket(AF_INET, SOCK_STREAM, 0);
  if (lsock < 0) return false;
  int one = 1; setsockopt(lsock, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  struct sockaddr_in a = { 0 };
  a.sin_family = AF_INET; a.sin_port = htons(LL_PORT); a.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(lsock, (struct sockaddr *)&a, sizeof a) < 0 || listen(lsock, 4) < 0) { close(lsock); lsock = -1; return false; }
  fcntl(lsock, F_SETFL, fcntl(lsock, F_GETFL, 0) | O_NONBLOCK);
  return true;
}
void ll_net_stop(void) { if (conn.fd >= 0) close(conn.fd); if (lsock >= 0) close(lsock); conn.fd = lsock = -1; }

static void json_str(char *o, size_t cap, const char *s) {
  size_t k = 0;
  if (k < cap) o[k++] = '"';
  for (; *s && k + 7 < cap; s++) {
    unsigned char c = (unsigned char)*s;
    if (c == '"' || c == '\\') { o[k++] = '\\'; o[k++] = c; }
    else if (c < 0x20) k += snprintf(o + k, cap - k, "\\u%04x", c);
    else o[k++] = c;
  }
  if (k < cap) o[k++] = '"';
  o[k < cap ? k : cap - 1] = 0;
}

static void respond(int code, const char *type, const uint8_t *body, size_t n, const char *extra) {
  const char *text = code == 200 ? "OK" : code == 202 ? "Accepted" : code == 204 ? "No Content" : code == 400 ? "Bad Request" : code == 404 ? "Not Found" : code == 409 ? "Conflict" : code == 413 ? "Payload Too Large" : code == 422 ? "Unprocessable Entity" : "Error";
  int h = snprintf((char *)conn.out, OUT_CAP,
    "HTTP/1.1 %d %s\r\nContent-Type: %s\r\nContent-Length: %u\r\nConnection: close\r\nCache-Control: no-store\r\n"
    "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\n"
    "Access-Control-Allow-Headers: Content-Type\r\nAccess-Control-Allow-Private-Network: true\r\n"
    "Access-Control-Expose-Headers: X-Leaflet-CRC32, X-Leaflet-Card\r\n%s\r\n",
    code, text, type, (unsigned)n, extra ? extra : "");
  if (n) memcpy(conn.out + h, body, n);
  conn.outLen = h + n; conn.sent = 0;
}
static void respond_json(int code, const char *json) { respond(code, "application/json", (const uint8_t *)json, strlen(json), NULL); }
static void respond_error(int code, const char *why) {
  char e[400], j[460]; json_str(e, sizeof e, why); snprintf(j, sizeof j, "{\"error\":%s}", e); respond_json(code, j);
}

static const char *STATE_NAMES[] = { "idle", "confirm", "backup", "writing", "verifying", "restoring", "done", "failed", "updating" };

static void send_info(void) {
  char why[160] = "", t[64], c[16], w[200], j[1400];
  bool ready = ll_card_ready(why, sizeof why);
  if (ready && !chip.writable) snprintf(why, sizeof why, "%s", chip.why);
  json_str(t, sizeof t, card.title); json_str(c, sizeof c, card.code); json_str(w, sizeof w, why);
  char pw[120] = ""; bool power = plat_power_ok(pw, sizeof pw); char pj[160]; json_str(pj, sizeof pj, pw);
  char clk[32]; plat_clock(clk, sizeof clk);
  snprintf(j, sizeof j,
    "{\"app\":\"Leaflet Link\",\"version\":\"%s\",\"protocol\":%d,\"state\":\"%s\",\"clock\":\"%s\","
    "\"card\":{\"present\":%s,\"ds\":%s,\"title\":%s,\"code\":%s,\"ready\":%s,\"writable\":%s,\"chipId\":\"%02X%02X%02X\",\"size\":%u,\"why\":%s},"
    "\"power\":{\"ok\":%s,\"why\":%s}}",
    LL_VERSION, LL_PROTOCOL, STATE_NAMES[st.state], clk, card.present ? "true" : "false", card.ds ? "true" : "false", t, c,
    ready ? "true" : "false", ready && chip.writable ? "true" : "false", chip.id[0], chip.id[1], chip.id[2], (unsigned)chip.size, w,
    power ? "true" : "false", pj);
  respond_json(200, j);
}

static void send_status(void) {
  char t[80], m[1000], b[200], tw[60], v[40], j[1600];
  json_str(v, sizeof v, st.update ? st.version : "");
  json_str(t, sizeof t, st.title); json_str(m, sizeof m, st.message); json_str(b, sizeof b, st.backup); json_str(tw, sizeof tw, st.town);
  snprintf(j, sizeof j, "{\"state\":\"%s\",\"job\":%u,\"progress\":%.3f,\"title\":%s,\"message\":%s,\"town\":%s,\"backup\":%s,\"changed\":%d,\"written\":%d,\"restored\":%s,\"update\":%s,\"version\":%s}",
    STATE_NAMES[st.state], (unsigned)st.job, st.progress, t, m, tw, b, st.changed, st.written, st.restored ? "true" : "false", st.update ? "true" : "false", v);
  respond_json(200, j);
}

static void send_save(void) {
  char why[160];
  if (st.state != LL_IDLE && st.state != LL_DONE && st.state != LL_FAILED) { respond_error(409, "Leaflet Link is busy saving. Try again when the 3DS says it's done."); return; }
  refresh_card(true);
  if (!ll_card_ready(why, sizeof why)) { respond_error(409, why); return; }
  if (!read_stable(scratch)) { respond_error(500, "The game card couldn't be read reliably (two reads never agreed). Clean the game card's contacts and try again."); return; }
  char extra[120];
  snprintf(extra, sizeof extra, "X-Leaflet-CRC32: %08x\r\nX-Leaflet-Card: %s\r\n", (unsigned)ll_crc32(scratch, LL_SAVE_SIZE), card.code);
  respond(200, "application/octet-stream", scratch, LL_SAVE_SIZE, extra);
}

static int hexval(int c) { return c >= '0' && c <= '9' ? c - '0' : c >= 'a' && c <= 'f' ? c - 'a' + 10 : c >= 'A' && c <= 'F' ? c - 'A' + 10 : -1; }
// Finds key=value in a query string and URL-decodes it into out (control characters dropped).
static bool query(const char *q, const char *key, char *out, size_t cap) {
  size_t kl = strlen(key);
  for (const char *p = q; p && *p; p = strchr(p, '&') ? strchr(p, '&') + 1 : NULL) {
    if (strncmp(p, key, kl) || p[kl] != '=') continue;
    size_t k = 0;
    for (const char *v = p + kl + 1; *v && *v != '&' && k + 1 < cap; v++) {
      int c = (unsigned char)*v;
      if (c == '+') c = ' ';
      else if (c == '%' && hexval(v[1]) >= 0 && hexval(v[2]) >= 0) { c = hexval(v[1]) * 16 + hexval(v[2]); v += 2; }
      if (c >= 0x20 && c != 0x7F) out[k++] = (char)c;
    }
    out[k] = 0;
    return true;
  }
  out[0] = 0;
  return false;
}

static void handle(void) {
  char line[600];
  size_t i = 0;
  while (i < conn.hdrEnd && i + 1 < sizeof line && conn.in[i] != '\r') { line[i] = (char)conn.in[i]; i++; }
  line[i] = 0;
  char method[8] = "", target[560] = "";
  sscanf(line, "%7s %559s", method, target);
  char *q = strchr(target, '?');
  if (q) *q++ = 0;
  const uint8_t *body = conn.in + conn.hdrEnd;
  size_t blen = conn.inLen - conn.hdrEnd;

  if (!strcmp(method, "OPTIONS")) { respond(204, "text/plain", NULL, 0, NULL); return; }
  if (!strcmp(method, "GET") && !strcmp(target, "/info")) { send_info(); return; }
  if (!strcmp(method, "GET") && !strcmp(target, "/status")) { send_status(); return; }
  if (!strcmp(method, "GET") && !strcmp(target, "/save")) { send_save(); return; }
  if (!strcmp(method, "POST") && !strcmp(target, "/save")) {
    char crc[16], town[sizeof st.town], res[sizeof st.residents], job[16], why[240];
    query(q, "crc", crc, sizeof crc); query(q, "town", town, sizeof town); query(q, "residents", res, sizeof res); query(q, "job", job, sizeof job);
    if (strlen(crc) != 8) { respond_error(400, "Missing CRC."); return; }
    int code = stage(body, blen, (uint32_t)strtoul(crc, NULL, 16), town, res, (uint32_t)strtoul(job, NULL, 10), conn.ip, why, sizeof why);
    if (code) respond_error(code, why); else send_status();
    return;
  }
  if (!strcmp(method, "POST") && !strcmp(target, "/update")) {
    char crc[16], version[16], job[16], why[240];
    query(q, "crc", crc, sizeof crc); query(q, "version", version, sizeof version); query(q, "job", job, sizeof job);
    if (strlen(crc) != 8) { respond_error(400, "Missing CRC."); return; }
    int code = stage_update(body, blen, (uint32_t)strtoul(crc, NULL, 16), version, (uint32_t)strtoul(job, NULL, 10), conn.ip, why, sizeof why);
    if (code) respond_error(code, why); else send_status();
    return;
  }
  if (!strcmp(method, "POST") && !strcmp(target, "/cancel")) {
    if (st.state == LL_CONFIRM) ll_answer(false);
    send_status();
    return;
  }
  respond_error(404, "Unknown request.");
}

static void drop(void) { if (conn.fd >= 0) close(conn.fd); conn.fd = -1; }

void ll_net_poll(void) {
  if (lsock < 0) return;
  if (conn.fd < 0) {
    struct sockaddr_in a; socklen_t al = sizeof a;
    int fd = accept(lsock, (struct sockaddr *)&a, &al);
    if (fd < 0) return;
    fcntl(fd, F_SETFL, fcntl(fd, F_GETFL, 0) | O_NONBLOCK);
    conn.fd = fd; conn.inLen = conn.hdrEnd = conn.need = conn.outLen = conn.sent = 0; conn.t = plat_ms(); conn.closing = 0;
    plat_socket_opened(fd);
    snprintf(conn.ip, sizeof conn.ip, "%s", inet_ntoa(a.sin_addr));
  }
  if (conn.closing) {
    // The response is out. Closing a socket on the 3DS can throw away data still waiting to go, which cut saves
    // off part-way; so after the last byte the sending side is shut (the data still goes, then the end-of-stream), and
    // the socket is closed only once Leaflet has read everything and closed its side, or after 3 seconds.
    uint8_t sink[256];
    ssize_t k = recv(conn.fd, sink, sizeof sink, 0);
    if (k == 0 || (k < 0 && errno != EAGAIN && errno != EWOULDBLOCK) || plat_ms() - conn.closing > 3000) drop();
    return;
  }
  if (plat_ms() - conn.t > 20000) { drop(); return; }   // stalled
  if (conn.outLen) {   // sending the response
    while (conn.sent < conn.outLen) {
      ssize_t k = send(conn.fd, conn.out + conn.sent, conn.outLen - conn.sent > 0x4000 ? 0x4000 : conn.outLen - conn.sent, 0);
      if (k > 0) { conn.sent += (size_t)k; conn.t = plat_ms(); continue; }
      if (k < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return;
      drop(); return;
    }
    shutdown(conn.fd, SHUT_WR);
    conn.closing = plat_ms();
    return;
  }
  for (;;) {   // receiving the request
    if (conn.inLen >= REQ_CAP) { respond_error(413, "That request is too big."); return; }
    ssize_t k = recv(conn.fd, conn.in + conn.inLen, REQ_CAP - conn.inLen, 0);
    if (k == 0) { drop(); return; }
    if (k < 0) { if (errno == EAGAIN || errno == EWOULDBLOCK) break; drop(); return; }
    conn.inLen += (size_t)k; conn.t = plat_ms();
  }
  if (!conn.hdrEnd) {
    for (size_t i = 3; i < conn.inLen; i++) if (!memcmp(conn.in + i - 3, "\r\n\r\n", 4)) { conn.hdrEnd = i + 1; break; }
    if (!conn.hdrEnd) return;
    conn.need = 0;
    for (size_t i = 0; i + 15 < conn.hdrEnd; i++) {
      if (strncasecmp((char *)conn.in + i, "\ncontent-length:", 16) == 0) { conn.need = strtoul((char *)conn.in + i + 16, NULL, 10); break; }
    }
    if (conn.need > LL_APP_MAX) { respond_error(413, "That request is too big."); return; }
  }
  if (conn.inLen - conn.hdrEnd < conn.need) return;
  conn.inLen = conn.hdrEnd + conn.need;
  handle();
}
