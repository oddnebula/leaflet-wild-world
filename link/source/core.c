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
// A save from the SD card (a backup, or a TWiLight Menu++ save) goes through exactly the same steps. Writing a game's
// save file on the SD card keeps a copy of the old file first, writes the new one beside it, reads it back, and only
// then swaps it in.
#include "core.h"
#include "chars.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <unistd.h>
#include <time.h>
#include <dirent.h>
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <sys/stat.h>

// ---- save layout (matches js/save.js) -----------------------------------------------------------------------------
#define BLOCK 0x15FE0
#define COPY2 0x15FE0
#define LETTERS 0x2E20C
#define LETTERS_SIZE 0x11DF4
#define PLAYER 0xC
#define PLAYER_SIZE 0x228C

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

static void decode(const uint8_t *d, size_t n, char *out, size_t cap) {
  size_t k = 0;
  out[0] = 0;
  for (size_t i = 0; i < n && d[i]; i++) {
    const char *c = LL_CHARS[d[i]];
    size_t l = strlen(c);
    if (k + l + 1 > cap) break;
    memcpy(out + k, c, l); k += l;
  }
  out[k] = 0;
  while (k && out[k - 1] == ' ') out[--k] = 0;
}

void ll_describe(const uint8_t *d, char *town, size_t townCap, char *residents, size_t resCap) {
  size_t at = copy_ok(d, 0) ? 0 : COPY2;
  decode(d + at + 4, 8, town, townCap);
  if (!town[0]) snprintf(town, townCap, "a town");
  residents[0] = 0;
  for (int p = 0; p < 4; p++) {
    size_t b = at + PLAYER + p * PLAYER_SIZE;
    uint16_t id = d[b + 0x2280] | (d[b + 0x2281] << 8);
    if (!id || id == 0xFFFF) continue;
    char name[40]; decode(d + b + 0x2282, 8, name, sizeof name);
    size_t k = strlen(residents);
    snprintf(residents + k, resCap - k, "%s%s", k ? ", " : "", name);
  }
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
  // Most flash chips give their size as a power of two in the third ID byte; a few don't, and are listed here.
  // 62 16 00: Sanyo LE25FW203T, 2 Mbit (256 KB), found in Wild World cards. Writing still tries each method and checks
  // every page by reading it back, so a chip that won't take one is handled the same way as before.
  static const struct { uint8_t id[3]; uint32_t size; } KNOWN[] = { { { 0x62, 0x16, 0x00 }, 256 * 1024 } };
  for (size_t i = 0; i < sizeof KNOWN / sizeof KNOWN[0]; i++) if (!memcmp(chip.id, KNOWN[i].id, 3)) chip.size = KNOWN[i].size;
  if (!chip.size && chip.id[2] >= 0x10 && chip.id[2] <= 0x17) chip.size = 1u << chip.id[2];
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
static uint8_t *incoming, *original, *scratch, *scratch2, *app, *filebuf, *sdOld;
static size_t appLen, sdOldLen;
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
static bool free_for_job(void) { return st.state == LL_IDLE || st.state == LL_DONE || st.state == LL_FAILED; }
// Starts a new job's status from scratch.
static void new_job(LLJob kind, uint32_t job, const char *peer) {
  st.kind = kind; st.job = job; st.changed = st.written = 0;
  st.restored = st.update = st.quit = st.caution = false;
  st.backup[0] = st.version[0] = st.town[0] = st.residents[0] = st.source[0] = st.target[0] = 0;
  snprintf(st.peer, sizeof st.peer, "%s", peer ? peer : "");
}

// ---- files on the SD card -----------------------------------------------------------------------------------------
static void full_path(char *out, size_t cap, const char *rel) { snprintf(out, cap, "%s%s", plat_sd_root(), rel); }
// Creates each folder of rel (from the SD card's root) that doesn't exist yet.
static void make_dirs(const char *rel) {
  char p[300];
  full_path(p, sizeof p, rel);
  for (char *c = p + strlen(plat_sd_root()); *c; c++) if (*c == '/') { *c = 0; mkdir(p, 0777); *c = '/'; }
  mkdir(p, 0777);
}
static bool read_file(const char *full, uint8_t *d, size_t cap, size_t *n) {
  FILE *f = fopen(full, "rb");
  if (!f) return false;
  *n = fread(d, 1, cap, f);
  bool more = fgetc(f) != EOF;
  fclose(f);
  return !more;
}
// The file holds exactly these n bytes.
static bool file_is(const char *full, const uint8_t *d, size_t n) {
  FILE *f = fopen(full, "rb");
  if (!f) return false;
  uint8_t buf[0x1000];
  size_t at = 0, k;
  bool ok = true;
  while (ok && (k = fread(buf, 1, sizeof buf, f)) > 0) { ok = at + k <= n && !memcmp(buf, d + at, k); at += k; }
  fclose(f);
  return ok && at == n;
}
// Writes a file and reads it back to check every byte.
static bool write_checked(const char *full, const uint8_t *d, size_t n) {
  FILE *f = fopen(full, "wb");
  if (!f) return false;
  bool ok = fwrite(d, 1, n, f) == n;
  ok = fclose(f) == 0 && ok;
  return ok && file_is(full, d, n);
}
// Keeps a copy in Leaflet Link's backups folder; st.backup gets its path as people see it on the SD card.
static bool keep_backup(const char *what, const uint8_t *d, size_t n) {
  char stamp[40], rel[200], full[300];
  plat_stamp(stamp, sizeof stamp);
  make_dirs(LL_BACKUP_DIR);
  snprintf(rel, sizeof rel, "%s/%s %s.sav", LL_BACKUP_DIR, stamp, what);
  full_path(full, sizeof full, rel);
  snprintf(st.backup, sizeof st.backup, "%s", rel);
  return write_checked(full, d, n);
}
static const char *base_name(const char *path) { const char *b = strrchr(path, '/'); return b ? b + 1 : path; }

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
  filebuf = malloc(LL_SAVE_SIZE);
  set_state(LL_IDLE, "Ready", "Waiting for Leaflet.");
  refresh_card(true);
}

// A save arrived from Leaflet. Returns 0 and waits for the person, or an HTTP status with the reason in why.
// source: where it comes from when it isn't Leaflet (a file on the SD card), else NULL.
static int stage(const uint8_t *body, size_t n, uint32_t crc, const char *town, const char *residents, uint32_t job, const char *peer, const char *source, char *why, size_t cap) {
  if (!free_for_job()) { say(why, cap, "Leaflet Link is busy with another save. Finish that one on the 3DS first."); return 409; }
  if (n != LL_SAVE_SIZE) { say(why, cap, "The save must be exactly 256 KB (got %u bytes).", (unsigned)n); return 400; }
  if (ll_crc32(body, n) != crc) { say(why, cap, "The save was damaged on its way over Wi-Fi (its CRC didn't match). Nothing was written; send it again."); return 400; }
  if (ll_check_save(body, why, cap)) return 422;
  refresh_card(true);
  if (!ll_card_ready(why, cap)) return 409;
  if (!chip.writable) { say(why, cap, "%s", chip.why); return 409; }
  memcpy(incoming, body, n);
  memcpy(jobCode, card.code, sizeof jobCode);
  new_job(LL_JOB_CARD, job, peer);
  snprintf(st.town, sizeof st.town, "%s", town[0] ? town : "your town");
  snprintf(st.residents, sizeof st.residents, "%s", residents);
  if (source) {
    snprintf(st.source, sizeof st.source, "%s", source);
    set_state(LL_CONFIRM, "Save to your game card?", "Put %s from %s on this game card? Press A to save it, or B to cancel.", st.town, source);
  } else set_state(LL_CONFIRM, "Save to your game card?", "Leaflet on %s wants to save %s to this game card. Press A to save it, or B to cancel.", peer, st.town);
  return 0;
}

// A new Leaflet Link arrived from Leaflet. Same rules as a save: checked first, then the person decides.
static int stage_update(const uint8_t *body, size_t n, uint32_t crc, const char *version, uint32_t job, const char *peer, char *why, size_t cap) {
  if (!free_for_job()) { say(why, cap, "Leaflet Link is busy. Finish on the 3DS first."); return 409; }
  if (n < 0x1000 || n > LL_APP_MAX || memcmp(body, "3DSX", 4)) { say(why, cap, "That isn't a 3DS homebrew app (.3dsx)."); return 400; }
  if (ll_crc32(body, n) != crc) { say(why, cap, "The update was damaged on its way over Wi-Fi (its CRC didn't match). Nothing was changed; try again."); return 400; }
  if (!app) app = malloc(LL_APP_MAX);
  if (!app) { say(why, cap, "Not enough memory for the update."); return 500; }
  memcpy(app, body, n); appLen = n;
  new_job(LL_JOB_UPDATE, job, peer);
  st.update = true;
  snprintf(st.version, sizeof st.version, "%s", version[0] ? version : "?");
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

static bool card_still_there(void);

// ---- the console's own Back up -------------------------------------------------------------------------------------
bool ll_start_backup(char *why, size_t cap) {
  if (!free_for_job()) { say(why, cap, "Leaflet Link is busy. Finish on the 3DS first."); return false; }
  refresh_card(true);
  if (!ll_card_ready(why, cap)) return false;
  memcpy(jobCode, card.code, sizeof jobCode);
  new_job(LL_JOB_BACKUP, 0, NULL);
  set_state(LL_BACKUP, "Backing up", "Reading the game card and copying its save to the SD card.");
  return true;
}

static void step_card_backup(void) {
  char why[160];
  if (!card_still_there() || !ll_card_ready(why, sizeof why)) { set_state(LL_FAILED, "Not backed up", "The game card was taken out. Nothing was changed."); return; }
  if (!read_stable(original)) { set_state(LL_FAILED, "Not backed up", "The game card couldn't be read reliably (two reads never agreed). Clean the game card's contacts and try again. Nothing was changed."); return; }
  if (ll_save_blank(original)) { set_state(LL_FAILED, "Nothing to back up", "This game card has never been saved, so there's no town on it yet."); return; }
  ll_describe(original, st.town, sizeof st.town, st.residents, sizeof st.residents);
  char name[40];
  snprintf(name, sizeof name, "%s backup", card.code);
  if (!keep_backup(name, original, LL_SAVE_SIZE)) { set_state(LL_FAILED, "Not backed up", "The copy couldn't be written to the SD card (is it full or locked?). The game card wasn't changed."); return; }
  if (ll_check_save(original, why, sizeof why)) {
    st.caution = true;
    set_state(LL_DONE, "Backed up, with a warning", "The save is copied to %s exactly as it is on the card, but %s Open it in Leaflet's Save Doctor for a closer look.", st.backup, why);
  } else set_state(LL_DONE, "Backed up!", "%s is copied to the SD card and checked byte for byte: %s. Press Y to see your backups and put one back.", st.town, st.backup);
}

// ---- health check -------------------------------------------------------------------------------------------------
// Reads the whole save chip HEALTH_PASSES times, comparing every 4 KB area with the first read. A healthy card reads
// the same every time; a dirty contact flips a bit now and then. It never writes.
#define HEALTH_PASSES 6
static LLHealth health;
static struct { int pass; uint32_t at; uint64_t t0, unstable; } hc;
const LLHealth *ll_health(void) { return &health; }

bool ll_start_health(char *why, size_t cap) {
  if (!free_for_job()) { say(why, cap, "Leaflet Link is busy. Finish on the 3DS first."); return false; }
  refresh_card(true);
  if (!ll_card_ready(why, cap)) return false;
  if (!chip.writable) { say(why, cap, "%s", chip.why); return false; }
  memcpy(jobCode, card.code, sizeof jobCode);
  new_job(LL_JOB_HEALTH, 0, NULL);
  memset(&health, 0, sizeof health); memset(&hc, 0, sizeof hc);
  health.idStable = true; hc.t0 = plat_ms();
  set_state(LL_CHECKING, "Checking the game card", "Reading the save chip %d times and comparing every byte. Nothing is written.", HEALTH_PASSES);
  return true;
}

static int bits(uint8_t x) { int n = 0; while (x) { n += x & 1; x >>= 1; } return n; }

static void health_done(void) {
  health.ms = (uint32_t)(plat_ms() - hc.t0);
  for (int i = 0; i < 64; i++) if (hc.unstable >> i & 1) health.unstable++;
  // Judge the save on an agreed copy when some reads differed.
  bool readable = !health.unstable || read_stable(scratch);
  health.blank = readable && ll_save_blank(scratch);
  health.check = readable ? (health.blank ? 0 : ll_check_save(scratch, health.checkWhy, sizeof health.checkWhy)) : -1;
  if (readable && !health.blank) ll_describe(scratch, st.town, sizeof st.town, st.residents, sizeof st.residents);
  char chipLine[120] = "";
  if (!health.idStable) snprintf(chipLine, sizeof chipLine, " The chip's ID also changed between reads.");
  if (health.unstable || !health.idStable) {
    st.caution = true;
    set_state(LL_DONE, "Reads didn't always match",
      "%d of 64 areas read differently at least once (%d bit%s in all, the first at 0x%05X).%s That's usually dust on the game card's contacts: clean them gently and check again. Saving stays safe, because Leaflet Link reads until two reads agree and checks every write, but it may need more tries.",
      health.unstable, health.flips, health.flips == 1 ? "" : "s", (unsigned)health.firstBad, chipLine);
  } else if (health.blank) {
    set_state(LL_DONE, "Healthy, and empty", "The save chip read the same all %d times. This game card has never been saved, so there's no town on it yet.", health.passes);
  } else if (health.check) {
    st.caution = true;
    set_state(LL_DONE, "The chip is fine; the save isn't", "Every read matched, so the save chip is healthy, but %s Open the town in Leaflet's Save Doctor for a closer look.", health.checkWhy);
  } else {
    set_state(LL_DONE, "Your game card is healthy", "The save chip read the same all %d times, byte for byte, and both copies of %s and the town hall letters pass their checksums.", health.passes, st.town);
  }
}

static void step_health(void) {
  if (!card_still_there()) { set_state(LL_FAILED, "Check stopped", "The game card was taken out. Nothing was changed."); return; }
  uint64_t until = plat_ms() + 20;
  while (plat_ms() < until) {
    if (hc.at == 0) {   // each pass starts by asking the chip for its ID again
      uint8_t c = CMD_RDID, id[3];
      if (!plat_spi(&c, 1, id, 3, NULL, 0)) { set_state(LL_FAILED, "Check stopped", "The console couldn't reach the save chip. Take the game card out, put it back in and try again."); return; }
      if (memcmp(id, chip.id, 3)) health.idStable = false;
    }
    uint8_t *dst = hc.pass ? scratch2 : scratch + hc.at;
    if (!chip_read(hc.at, dst, 0x1000)) { set_state(LL_FAILED, "Check stopped", "The console couldn't read the save chip. Take the game card out, put it back in and try again."); return; }
    if (hc.pass) {
      int flips = 0;
      for (int i = 0; i < 0x1000; i++) flips += bits(dst[i] ^ scratch[hc.at + i]);
      if (flips) { if (!health.flips || hc.at < health.firstBad) health.firstBad = hc.at; hc.unstable |= 1ULL << (hc.at / 0x1000); health.flips += flips; }
    }
    hc.at += 0x1000;
    if (hc.at == LL_SAVE_SIZE) { hc.at = 0; health.passes = ++hc.pass; if (hc.pass == HEALTH_PASSES) { health_done(); return; } }
  }
  st.progress = (hc.pass * (float)LL_SAVE_SIZE + hc.at) / ((float)LL_SAVE_SIZE * HEALTH_PASSES);
}

// ---- saves on the SD card -----------------------------------------------------------------------------------------
// Leaflet Link's own backups, and the save files DS homebrew loaders keep next to the game: TWiLight Menu++ and
// nds-bootstrap (and the forwarders made for them) use a "saves" folder beside the .nds, or the same folder.
static LLSaveFile sdList[LL_SD_MAX];
static int sdN, sdVisited;

const LLSaveFile *ll_sd_list(int *n) { *n = sdN; return sdList; }

static int64_t days_from_civil(int y, int m, int d) {
  y -= m <= 2;
  int64_t era = (y >= 0 ? y : y - 399) / 400;
  int yoe = (int)(y - era * 400), doy = (153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1, doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return era * 146097 + doe - 719468;
}
// "2026-10-28 14.03.22 ..." at the start of a backup's name, as seconds.
static int64_t stamp_time(const char *name) {
  int y, mo, d, h, mi, se;
  if (sscanf(name, "%4d-%2d-%2d %2d.%2d.%2d", &y, &mo, &d, &h, &mi, &se) != 6) return 0;
  return days_from_civil(y, mo, d) * 86400 + h * 3600 + mi * 60 + se;
}

static bool is_save_name(const char *n) {
  const char *dot = strrchr(n, '.');
  if (!dot) return false;
  if (!strcasecmp(dot, ".sav")) return true;
  return !strncasecmp(dot, ".sav", 4) && dot[4] >= '1' && dot[4] <= '9' && !dot[5];   // nds-bootstrap's extra save slots
}

static void sd_consider(const char *rel, bool backup, int64_t size) {
  if (sdN >= LL_SD_MAX || size < LL_SAVE_SIZE || size > LL_FILE_MAX) return;
  char full[300];
  full_path(full, sizeof full, rel);
  FILE *f = fopen(full, "rb");
  if (!f) return;
  // Most saves aren't Wild World's: look at the two bytes that say which region each copy of the town is first.
  uint8_t r0 = 0, r1 = 0;
  bool maybe = fread(&r0, 1, 1, f) == 1 && fseek(f, COPY2, SEEK_SET) == 0 && fread(&r1, 1, 1, f) == 1 && (r0 == 0x8A || r0 == 0xC5 || r1 == 0x8A || r1 == 0xC5);
  bool whole = maybe && fseek(f, 0, SEEK_SET) == 0 && fread(filebuf, 1, LL_SAVE_SIZE, f) == LL_SAVE_SIZE;
  fclose(f);
  if (!whole) return;
  int region = ll_save_region(filebuf);
  if (!region) return;
  LLSaveFile *e = &sdList[sdN++];
  memset(e, 0, sizeof *e);
  snprintf(e->path, sizeof e->path, "%.159s", rel);   // paths over 160 characters are skipped before this
  e->size = (uint32_t)size; e->region = (uint8_t)region; e->backup = backup;
  char why[8];
  e->ok = !ll_check_save(filebuf, why, sizeof why);
  ll_describe(filebuf, e->town, sizeof e->town, e->residents, sizeof e->residents);
  e->mtime = backup ? stamp_time(base_name(rel)) : 0;
  if (!e->mtime) e->mtime = plat_mtime(full);
}

// Folders at the SD card's root that never hold DS saves (or hold far too many files to look through).
static const char *SKIP[] = { "Nintendo 3DS", "3ds", "DCIM", "luma", "gm9", "private", "Nintendo DSiWare", "cias", "Themes", NULL };

static int newest_first(const void *a, const void *b) {
  int64_t x = ((const LLSaveFile *)a)->mtime, y = ((const LLSaveFile *)b)->mtime;
  return x < y ? 1 : x > y ? -1 : 0;
}

// The search runs a slice at a time (ll_tick), so the screen keeps drawing and Leaflet keeps getting answers while a
// big SD card is looked through. It walks the backups folder first, then the card itself, with one open folder per
// level.
#define SCAN_DEPTH 6
static struct { bool active; int depth; DIR *dirs[SCAN_DEPTH + 1]; size_t lens[SCAN_DEPTH + 1]; char rel[200]; uint64_t done; } scan;

static bool scan_push(size_t len) {
  char full[300];
  full_path(full, sizeof full, len ? scan.rel : "/");
  DIR *d = opendir(full);
  if (!d) return false;
  scan.depth++; scan.dirs[scan.depth] = d; scan.lens[scan.depth] = len;
  return true;
}

void ll_sd_scan_begin(void) {
  while (scan.active && scan.depth >= 0) closedir(scan.dirs[scan.depth--]);
  sdN = sdVisited = 0;
  memset(&scan, 0, sizeof scan);
  scan.active = true; scan.depth = -1;
  // Leaflet Link's own backups (depth 0, marked by the folder) go first; the walk of the card starts when they're done.
  snprintf(scan.rel, sizeof scan.rel, "%s", LL_BACKUP_DIR);
  if (!scan_push(strlen(scan.rel))) { scan.rel[0] = 0; scan_push(0); }
}

bool ll_sd_scanning(void) { return scan.active; }

// Looks through the SD card for up to ms milliseconds. True once the search is finished.
bool ll_sd_scan_step(uint32_t ms) {
  if (!scan.active) return true;
  uint64_t until = plat_ms() + ms;
  while (plat_ms() < until || !ms) {
    if (scan.depth < 0 || sdN >= LL_SD_MAX || sdVisited >= 6000) {
      while (scan.depth >= 0) closedir(scan.dirs[scan.depth--]);
      // After the backups folder, the card itself.
      if (scan.lens[0] && !strcmp(scan.rel, LL_BACKUP_DIR) && sdN < LL_SD_MAX && sdVisited < 6000) { scan.rel[0] = 0; memset(scan.lens, 0, sizeof scan.lens); if (scan_push(0)) continue; }
      scan.active = false; scan.done = plat_ms();
      qsort(sdList, sdN, sizeof *sdList, newest_first);
      return true;
    }
    bool inBackups = !strncmp(scan.rel, LL_BACKUP_DIR, strlen(LL_BACKUP_DIR)) && scan.lens[0];
    size_t len = scan.lens[scan.depth];
    struct dirent *de = readdir(scan.dirs[scan.depth]);
    if (!de) { closedir(scan.dirs[scan.depth--]); if (scan.depth >= 0) scan.rel[scan.lens[scan.depth]] = 0; continue; }
    sdVisited++;
    const char *n = de->d_name;
    size_t l = strlen(n);
    if (n[0] == '.' || len + 1 + l + 1 > 160) continue;
    scan.rel[len] = '/'; memcpy(scan.rel + len + 1, n, l + 1);
    char child[300]; full_path(child, sizeof child, scan.rel);
    struct stat sb;
    bool pushed = false;
    if (!stat(child, &sb)) {
      if (S_ISDIR(sb.st_mode) && !inBackups) {
        bool skip = false;
        for (int i = 0; scan.depth == 0 && SKIP[i]; i++) if (!strcasecmp(n, SKIP[i])) skip = true;
        if (!skip && scan.depth < 5) pushed = scan_push(len + 1 + l);
      } else if (S_ISREG(sb.st_mode) && is_save_name(n)) sd_consider(scan.rel, inBackups, sb.st_size);
    }
    if (!pushed) scan.rel[len] = 0;
    if (!ms) continue;
  }
  return false;
}

int ll_sd_scan(void) {
  ll_sd_scan_begin();
  ll_sd_scan_step(0);
  return sdN;
}

static const LLSaveFile *sd_find(const char *rel) {
  for (int pass = 0; pass < 2; pass++) {
    for (int i = 0; i < sdN; i++) if (!strcmp(sdList[i].path, rel)) return &sdList[i];
    if (!pass) ll_sd_scan();
  }
  return NULL;
}

// The first 256 KB of a listed save (the rest of a padded file is never part of the save).
static bool sd_read(const LLSaveFile *e, uint8_t *d) {
  char full[300]; size_t n;
  full_path(full, sizeof full, e->path);
  FILE *f = fopen(full, "rb");
  if (!f) return false;
  n = fread(d, 1, LL_SAVE_SIZE, f);
  fclose(f);
  return n == LL_SAVE_SIZE;
}

bool ll_restore_from_sd(int index, char *why, size_t cap) {
  if (index < 0 || index >= sdN) { say(why, cap, "That save isn't on the list any more."); return false; }
  const LLSaveFile *e = &sdList[index];
  if (!sd_read(e, filebuf)) { say(why, cap, "%s couldn't be read from the SD card.", base_name(e->path)); return false; }
  char town[40], res[100], from[120];
  ll_describe(filebuf, town, sizeof town, res, sizeof res);
  snprintf(from, sizeof from, "%s", e->backup ? "a backup on the SD card" : base_name(e->path));
  int code = stage(filebuf, LL_SAVE_SIZE, ll_crc32(filebuf, LL_SAVE_SIZE), town, res, 0, "", from, why, cap);
  return code == 0;
}

// ---- a game's save file on the SD card ----------------------------------------------------------------------------
// From Leaflet: replace the save file of a DS game played through TWiLight Menu++ or a forwarder.
static int stage_sdfile(const uint8_t *body, size_t n, uint32_t crc, const char *rel, const char *town, const char *residents, uint32_t job, const char *peer, char *why, size_t cap) {
  if (!free_for_job()) { say(why, cap, "Leaflet Link is busy. Finish on the 3DS first."); return 409; }
  if (n != LL_SAVE_SIZE) { say(why, cap, "The save must be exactly 256 KB (got %u bytes).", (unsigned)n); return 400; }
  if (ll_crc32(body, n) != crc) { say(why, cap, "The save was damaged on its way over Wi-Fi (its CRC didn't match). Nothing was written; send it again."); return 400; }
  if (ll_check_save(body, why, cap)) return 422;
  const LLSaveFile *e = sd_find(rel);
  if (!e) { say(why, cap, "That save file isn't on the 3DS's SD card any more."); return 404; }
  if (e->backup) { say(why, cap, "Leaflet Link's own backups are kept as they are. Choose a game's save file instead."); return 409; }
  if (e->region != ll_save_region(body)) { say(why, cap, "That save file is from the %s version of the game, and this town is from the %s one. They can't read each other's saves.", e->region == 0x8A ? "USA" : "European", e->region == 0x8A ? "European" : "USA"); return 409; }
  memcpy(incoming, body, n);
  new_job(LL_JOB_SDFILE, job, peer);
  snprintf(st.target, sizeof st.target, "%s", e->path);
  snprintf(st.town, sizeof st.town, "%s", town[0] ? town : "your town");
  snprintf(st.residents, sizeof st.residents, "%s", residents);
  set_state(LL_CONFIRM, "Save to the SD card?", "Leaflet on %s wants to save %s to %s on the SD card. Press A to save it, or B to cancel.", peer, st.town, base_name(e->path));
  return 0;
}

static void step_sd_backup(void) {
  char full[300];
  full_path(full, sizeof full, st.target);
  if (!sdOld) sdOld = malloc(LL_FILE_MAX);
  if (!sdOld || !read_file(full, sdOld, LL_FILE_MAX, &sdOldLen) || sdOldLen < LL_SAVE_SIZE) { set_state(LL_FAILED, "Nothing was changed", "%s couldn't be read any more. Nothing was written.", base_name(st.target)); return; }
  int was = ll_save_region(sdOld);
  if (was && was != ll_save_region(incoming)) { set_state(LL_FAILED, "Nothing was changed", "That save file now holds a save from the other region's version of the game. Nothing was written."); return; }
  char stem[160], name[200];
  snprintf(stem, sizeof stem, "%s", base_name(st.target));
  char *dot = strrchr(stem, '.'); if (dot && dot > stem) *dot = 0;
  snprintf(name, sizeof name, "%s before Leaflet", stem);
  if (!keep_backup(name, sdOld, sdOldLen)) { set_state(LL_FAILED, "Nothing was changed", "The copy of the old save couldn't be written to the SD card (is it full or locked?). Nothing was written."); return; }
  memcpy(original, sdOld, LL_SAVE_SIZE);
  st.changed = memcmp(original, incoming, LL_SAVE_SIZE) ? 1 : 0;
  if (!st.changed) { set_state(LL_DONE, "Already up to date", "%s already holds exactly this save. Nothing needed writing.", base_name(st.target)); return; }
  set_state(LL_WRITING, "Saving to the SD card", "Writing %s. Keep the 3DS on.", base_name(st.target));
}

// The new file is written beside the old one and checked, then swapped in and checked again. If the swap goes wrong,
// the old save goes back from the copy just made.
static void step_sd_write(void) {
  char full[300], tmp[330];
  full_path(full, sizeof full, st.target);
  snprintf(tmp, sizeof tmp, "%s.leaflet-new", full);
  memcpy(sdOld, incoming, LL_SAVE_SIZE);   // the rest of a padded file stays as it was
  if (!write_checked(tmp, sdOld, sdOldLen)) { remove(tmp); set_state(LL_FAILED, "Nothing was changed", "The new save couldn't be written to the SD card (is it full or locked?). %s is exactly as it was.", base_name(st.target)); return; }
  set_state(LL_VERIFYING, "Checking", "Swapping in the new save and reading it back.");
  remove(full);
  bool ok = rename(tmp, full) == 0 && file_is(full, sdOld, sdOldLen);
  if (ok) { st.written = 1; set_state(LL_DONE, "Saved!", "%s is in %s on the SD card, read back and checked byte for byte. The previous save is at %s.", st.town, base_name(st.target), st.backup); return; }
  // Put the old file back.
  memcpy(sdOld, original, LL_SAVE_SIZE);
  remove(tmp);
  st.restored = write_checked(full, sdOld, sdOldLen);
  if (st.restored) set_state(LL_FAILED, "Your save is safe", "The new save didn't check out after it was swapped in, so the old one is back in %s and checked. Nothing changed.", base_name(st.target));
  else set_state(LL_FAILED, "Couldn't restore", "The new save didn't check out, and the old one couldn't be put back either. A copy of the old save is at %s; copy it over %s.", st.backup, st.target);
}

static void list_differences(const uint8_t *target) {
  todoN = todoAt = 0;
  for (int p = 0; p < LL_PAGES; p++) if (memcmp(scratch + p * LL_PAGE, target + p * LL_PAGE, LL_PAGE)) todo[todoN++] = (uint16_t)p;
}

static void fail(const char *fmt, ...) {
  char why[240];
  va_list ap; va_start(ap, fmt); vsnprintf(why, sizeof why, fmt, ap); va_end(ap);
  if (restoring) {
    set_state(LL_FAILED, "Couldn't restore", "%s Putting the original back failed too: %s Your game card may not load. The save that was on it is on the SD card at %s: put it back with Y (Saves on the SD card), or open it in Leaflet and send it again.", reason, why, st.backup);
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
  memcpy(scratch, original, LL_SAVE_SIZE);
  list_differences(incoming);
  st.changed = todoN; st.written = 0; restoring = checking = false; verifyPasses = 0;
  if (!todoN) { set_state(LL_DONE, "Already up to date", "The game card already has exactly this save. Nothing needed writing."); return; }
  // Only kept when something will be written (an identical save leaves nothing to undo).
  char name[40];
  snprintf(name, sizeof name, "%s before %s", card.code, st.source[0] ? "restoring" : "Leaflet");
  if (!keep_backup(name, original, LL_SAVE_SIZE)) { fail("The copy of your game card's save couldn't be written to the SD card (is it full or locked?)."); return; }
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
  if (scan.active) ll_sd_scan_step(15);
  switch (st.state) {
    case LL_CONFIRM:
      if (plat_ms() - st.since > 120000) set_state(LL_IDLE, "Ready", "The save wasn't confirmed within two minutes, so it was set aside. Nothing was written.");
      else if (!card.present && st.kind == LL_JOB_CARD) set_state(LL_IDLE, "Ready", "The game card was taken out, so the save was set aside. Nothing was written.");
      break;
    case LL_BACKUP: if (st.kind == LL_JOB_BACKUP) step_card_backup(); else if (st.kind == LL_JOB_SDFILE) step_sd_backup(); else step_backup(); break;
    case LL_WRITING: if (st.kind == LL_JOB_SDFILE) step_sd_write(); else step_write(); break;
    case LL_CHECKING: step_health(); break;
    case LL_VERIFYING: step_verify(); break;
    case LL_RESTORING: if (checking) step_verify(); else step_write(); break;
    case LL_UPDATING: step_update(); break;
    default: break;
  }
}

void ll_answer(bool yes) {
  if (st.state == LL_CONFIRM) {
    if (yes && st.update) set_state(LL_UPDATING, "Updating", "Installing Leaflet Link %s.", st.version);
    else if (yes && st.kind == LL_JOB_SDFILE) set_state(LL_BACKUP, "Keeping a copy", "Keeping a copy of the old save file on the SD card.");
    else if (yes) set_state(LL_BACKUP, "Keeping a copy", "Reading what's on the game card now and keeping a copy on the SD card.");
    else set_state(LL_IDLE, "Cancelled", "You cancelled on the 3DS. Nothing was written.");
  } else if (st.state == LL_CHECKING && !yes) {
    set_state(LL_IDLE, "Ready", "Check stopped. Nothing was changed.");
  } else if (st.state == LL_DONE || st.state == LL_FAILED) {
    set_state(LL_IDLE, "Ready", "Waiting for Leaflet.");
  }
}

// ---- HTTP ---------------------------------------------------------------------------------------------------------
// One connection at a time, every socket non-blocking, so the console's screen keeps drawing while data moves.
#define REQ_CAP (LL_APP_MAX + 0x2000)
#define OUT_CAP (LL_SAVE_SIZE + 0x1000)
static int lsock = -1, usock = -1;
// Discovery: Leaflet (the Mac app, or Leaflet Helper on Windows) broadcasts "leaflet-link?" to UDP port LL_PORT, and
// Leaflet Link answers "leaflet-link <version> <card code>", so nobody has to type the 3DS's address.
// If the socket can't be opened yet (Wi-Fi still connecting) or later fails, ll_net_poll tries again every few seconds.
// No SO_REUSEADDR: a UDP socket doesn't need it, and the 3DS's socket service may refuse it.
static uint64_t udpRetry;
static void udp_start(void) {
  if (usock >= 0) return;
  udpRetry = plat_ms() + 3000;
  usock = socket(AF_INET, SOCK_DGRAM, 0);
  if (usock < 0) return;
  struct sockaddr_in a = { 0 };
  a.sin_family = AF_INET; a.sin_port = htons(LL_PORT); a.sin_addr.s_addr = htonl(INADDR_ANY);
  if (bind(usock, (struct sockaddr *)&a, sizeof a) < 0) { close(usock); usock = -1; return; }
  fcntl(usock, F_SETFL, fcntl(usock, F_GETFL, 0) | O_NONBLOCK);
}
bool ll_discovery_on(void) { return usock >= 0; }
static void udp_poll(void) {
  if (usock < 0) return;
  for (int i = 0; i < 8; i++) {
    char buf[64]; struct sockaddr_in from; socklen_t fl = sizeof from;
    ssize_t n = recvfrom(usock, buf, sizeof buf - 1, 0, (struct sockaddr *)&from, &fl);
    if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK) { close(usock); usock = -1; return; }   // reopened soon
    if (n <= 0) return;
    buf[n] = 0;
    if (strncmp(buf, "leaflet-link?", 13)) continue;
    char reply[64];
    int k = snprintf(reply, sizeof reply, "leaflet-link %s %s", LL_VERSION, card.present && card.ds && card.code[0] ? card.code : "-");
    sendto(usock, reply, (size_t)k, 0, (struct sockaddr *)&from, fl);
  }
}
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
  udp_start();
  return true;
}
void ll_net_stop(void) { if (conn.fd >= 0) close(conn.fd); if (lsock >= 0) close(lsock); if (usock >= 0) close(usock); conn.fd = lsock = usock = -1; }

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

static const char *STATE_NAMES[] = { "idle", "confirm", "backup", "writing", "verifying", "restoring", "done", "failed", "updating", "checking" };
static const char *JOB_NAMES[] = { "card", "update", "sdfile", "backup", "health" };

static void send_info(void) {
  char why[160] = "", t[64], c[16], w[200], j[1400];
  bool ready = ll_card_ready(why, sizeof why);
  if (ready && !chip.writable) snprintf(why, sizeof why, "%s", chip.why);
  json_str(t, sizeof t, card.title); json_str(c, sizeof c, card.code); json_str(w, sizeof w, why);
  char pw[120] = ""; bool power = plat_power_ok(pw, sizeof pw); char pj[160]; json_str(pj, sizeof pj, pw);
  char clk[32]; plat_clock(clk, sizeof clk);
  snprintf(j, sizeof j,
    "{\"app\":\"Leaflet Link\",\"version\":\"%s\",\"protocol\":%d,\"state\":\"%s\",\"clock\":\"%s\",\"features\":[\"sd\",\"health\"],\"discovery\":%s,"
    "\"card\":{\"present\":%s,\"ds\":%s,\"title\":%s,\"code\":%s,\"ready\":%s,\"writable\":%s,\"chipId\":\"%02X%02X%02X\",\"size\":%u,\"why\":%s},"
    "\"power\":{\"ok\":%s,\"why\":%s}}",
    LL_VERSION, LL_PROTOCOL, STATE_NAMES[st.state], clk, usock >= 0 ? "true" : "false", card.present ? "true" : "false", card.ds ? "true" : "false", t, c,
    ready ? "true" : "false", ready && chip.writable ? "true" : "false", chip.id[0], chip.id[1], chip.id[2], (unsigned)chip.size, w,
    power ? "true" : "false", pj);
  respond_json(200, j);
}

static void send_status(void) {
  char t[80], m[1000], b[480], tw[60], v[40], src[200], tg[340], hj[640] = "null", j[3000];
  json_str(v, sizeof v, st.update ? st.version : "");
  json_str(t, sizeof t, st.title); json_str(m, sizeof m, st.message); json_str(b, sizeof b, st.backup); json_str(tw, sizeof tw, st.town);
  json_str(src, sizeof src, st.source); json_str(tg, sizeof tg, st.target);
  if (st.kind == LL_JOB_HEALTH) {
    char cw[340]; json_str(cw, sizeof cw, health.checkWhy);
    snprintf(hj, sizeof hj, "{\"passes\":%d,\"of\":%d,\"unstable\":%d,\"flips\":%d,\"firstBad\":%u,\"idStable\":%s,\"check\":%d,\"checkWhy\":%s,\"blank\":%s,\"ms\":%u}",
      health.passes, HEALTH_PASSES, health.unstable, health.flips, (unsigned)health.firstBad, health.idStable ? "true" : "false", health.check, cw, health.blank ? "true" : "false", (unsigned)health.ms);
  }
  snprintf(j, sizeof j, "{\"state\":\"%s\",\"kind\":\"%s\",\"job\":%u,\"progress\":%.3f,\"title\":%s,\"message\":%s,\"town\":%s,\"backup\":%s,\"changed\":%d,\"written\":%d,\"restored\":%s,\"update\":%s,\"version\":%s,\"source\":%s,\"target\":%s,\"caution\":%s,\"health\":%s}",
    STATE_NAMES[st.state], JOB_NAMES[st.kind], (unsigned)st.job, st.progress, t, m, tw, b, st.changed, st.written, st.restored ? "true" : "false", st.update ? "true" : "false", v, src, tg, st.caution ? "true" : "false", hj);
  respond_json(200, j);
}

// Wall-clock seconds as "2026-10-28 14:03:22".
static void wall_text(int64_t t, char *out, size_t cap) {
  if (!t) { snprintf(out, cap, "%s", ""); return; }
  time_t tt = (time_t)t; struct tm tm;
  gmtime_r(&tt, &tm);
  strftime(out, cap, "%Y-%m-%d %H:%M:%S", &tm);
}

// Starts a search unless one is running or just finished; answers with what's been found so far. Leaflet asks again
// while "scanning" is true.
static void send_sd_list(bool fresh) {
  if (!free_for_job()) { respond_error(409, "Leaflet Link is busy. Try again when the 3DS says it's done."); return; }
  if (!scan.active && (fresh || !scan.done || plat_ms() - scan.done > 5000)) ll_sd_scan_begin();
  static char j[LL_SD_MAX * 700 + 64];
  size_t k = (size_t)snprintf(j, sizeof j, "{\"scanning\":%s,\"saves\":[", scan.active ? "true" : "false");
  for (int i = 0; i < sdN; i++) {
    const LLSaveFile *e = &sdList[i];
    char p[340], tw[100], r[220], when[32];
    json_str(p, sizeof p, e->path); json_str(tw, sizeof tw, e->town); json_str(r, sizeof r, e->residents); wall_text(e->mtime, when, sizeof when);
    k += (size_t)snprintf(j + k, sizeof j - k, "%s{\"path\":%s,\"town\":%s,\"residents\":%s,\"size\":%u,\"saved\":\"%s\",\"region\":\"%s\",\"ok\":%s,\"kind\":\"%s\"}",
      i ? "," : "", p, tw, r, (unsigned)e->size, when, e->region == 0x8A ? "USA" : "Europe", e->ok ? "true" : "false", e->backup ? "backup" : "game");
    if (k >= sizeof j) { respond_error(500, "Too many saves to list."); return; }
  }
  snprintf(j + k, sizeof j - k, "]}");
  respond_json(200, j);
}

static void send_sd_file(const char *rel) {
  const LLSaveFile *e = sd_find(rel);
  if (!e) { respond_error(404, "That save isn't on the 3DS's SD card any more."); return; }
  if (!sd_read(e, filebuf)) { respond_error(500, "The save couldn't be read from the SD card."); return; }
  char extra[120];
  snprintf(extra, sizeof extra, "X-Leaflet-CRC32: %08x\r\n", (unsigned)ll_crc32(filebuf, LL_SAVE_SIZE));
  respond(200, "application/octet-stream", filebuf, LL_SAVE_SIZE, extra);
}

static void send_save(void) {
  char why[160];
  if (!free_for_job()) { respond_error(409, "Leaflet Link is busy. Try again when the 3DS says it's done."); return; }
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
  char line[1600];
  size_t i = 0;
  while (i < conn.hdrEnd && i + 1 < sizeof line && conn.in[i] != '\r') { line[i] = (char)conn.in[i]; i++; }
  line[i] = 0;
  char method[8] = "", target[1560] = "";
  sscanf(line, "%7s %1559s", method, target);
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
    int code = stage(body, blen, (uint32_t)strtoul(crc, NULL, 16), town, res, (uint32_t)strtoul(job, NULL, 10), conn.ip, NULL, why, sizeof why);
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
    if (st.state == LL_CONFIRM || st.state == LL_CHECKING) ll_answer(false);
    send_status();
    return;
  }
  if (!strcmp(method, "POST") && !strcmp(target, "/health")) {
    char why[200];
    if (!ll_start_health(why, sizeof why)) { respond_error(409, why); return; }
    send_status();
    return;
  }
  if (!strcmp(method, "GET") && !strcmp(target, "/sd")) { char f[4]; send_sd_list(query(q, "fresh", f, sizeof f)); return; }
  if (!strcmp(target, "/sd/file")) {
    char path[200];
    if (!query(q, "path", path, sizeof path) || path[0] != '/') { respond_error(400, "Missing path."); return; }
    if (!strcmp(method, "GET")) { send_sd_file(path); return; }
    if (!strcmp(method, "POST")) {
      char crc[16], town[sizeof st.town], res[sizeof st.residents], job[16], why[240];
      query(q, "crc", crc, sizeof crc); query(q, "town", town, sizeof town); query(q, "residents", res, sizeof res); query(q, "job", job, sizeof job);
      if (strlen(crc) != 8) { respond_error(400, "Missing CRC."); return; }
      int code = stage_sdfile(body, blen, (uint32_t)strtoul(crc, NULL, 16), path, town, res, (uint32_t)strtoul(job, NULL, 10), conn.ip, why, sizeof why);
      if (code) respond_error(code, why); else send_status();
      return;
    }
  }
  respond_error(404, "Unknown request.");
}

static void drop(void) { if (conn.fd >= 0) close(conn.fd); conn.fd = -1; }

void ll_net_poll(void) {
  if (lsock < 0) return;
  if (usock < 0 && plat_ms() >= udpRetry) udp_start();
  udp_poll();
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
