// Leaflet Link simulator: the real core (../source/core.c) running on a computer, with a simulated game card whose
// save chip behaves like the SPI flash in a Wild World cartridge. It's how the protocol, the write engine and the
// recovery paths are tested without a 3DS, including faults a real card can have.
//
//   cc -O2 -Wall -o leaflet-link-sim ../source/core.c sim.c
//   ./leaflet-link-sim --card town.sav [--answer yes|no|ask] [--chip m45pe|plain|eeprom] [--flaky-reads N]
//                      [--stuck-page ADDR] [--deaf-pages N] [--pull-at N] [--low-battery] [--sd DIR]
//
// --card       the cartridge's save (256 KB); the simulated chip writes back to it when a job ends
// --answer     what the "person" presses when asked to confirm (ask = type y or n in this terminal; delay = A after 4 s)
// --chip       m45pe takes page writes (0x0A); plain only takes erase + program; eeprom doesn't identify itself;
//              sanyo answers 62 16 00 (no size in its ID, like the LE25FW203T) and takes only erase + program
// --flaky-reads N   every Nth read flips one bit, like a dirty card contact
// --stuck-page ADDR the page at ADDR never changes when written (a worn-out chip)
// --deaf-pages N    the first N page writes are ignored, then writes work (a card that needs a retry)
// --pull-at N       the card is "taken out" after N page writes
// --slow MS         each page write takes MS milliseconds (to watch progress)
// --abrupt-close    closing a connection discards unsent data, like the 3DS's network stack
// --clock-shift S   the simulated 3DS's clock is S seconds ahead of this computer's (negative: behind)
// --sd DIR          the simulated SD card (default sim-sd)
// --console         read the console's own menu from stdin, one per line: backup, health, scan, restore N, stop

#include "../source/core.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>
#include <fcntl.h>
#include <sys/socket.h>

static uint8_t flash[LL_SAVE_SIZE];
static const char *cardPath, *sdDir = "sim-sd";
static enum { M45PE, PLAIN, EEPROM, SANYO } kind = M45PE;
static int flakyEvery, deafLeft, pullAt = -1, writes, slowMs;
static long stuckPage = -1;
static bool lowBattery, pulled, wel, consoleMenu;
static uint64_t busyUntil;
static char answer[8] = "yes";

uint64_t plat_ms(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return (uint64_t)t.tv_sec * 1000 + t.tv_nsec / 1000000;
}

void plat_card(LLCard *c) {
  memset(c, 0, sizeof *c);
  if (pulled) return;
  c->present = c->ds = true;
  strcpy(c->code, "ADME"); strcpy(c->title, "ANIMALCROSSW");
}

static void program(uint32_t a, const uint8_t *d, size_t n, bool erase) {
  if (deafLeft > 0) { deafLeft--; return; }
  if ((long)(a & ~0xFFu) == stuckPage) return;
  for (size_t i = 0; i < n; i++) {
    uint32_t at = (a & ~0xFFu) | ((a + i) & 0xFF);   // page writes wrap within the page, like real chips
    flash[at] = erase ? d[i] : (flash[at] & d[i]);
  }
  if (pullAt >= 0 && ++writes >= pullAt) pulled = true;
}

bool plat_spi(const uint8_t *cmd, size_t cmdLen, uint8_t *rx, size_t rxLen, const uint8_t *tx, size_t txLen) {
  if (pulled || !cmdLen) return false;
  static unsigned reads;
  uint32_t a = cmdLen >= 4 ? (cmd[1] << 16 | cmd[2] << 8 | cmd[3]) % LL_SAVE_SIZE : 0;
  bool busy = plat_ms() < busyUntil;
  if (kind == EEPROM && cmd[0] == 0x9F) { memset(rx, 0xFF, rxLen); return true; }
  switch (cmd[0]) {
    case 0x9F: { uint8_t id[3] = { 0x20, 0x40, 0x12 }, sanyo[3] = { 0x62, 0x16, 0x00 }; memcpy(rx, kind == SANYO ? sanyo : id, rxLen < 3 ? rxLen : 3); return true; }
    case 0x05: if (rxLen) rx[0] = (busy ? 1 : 0) | (wel ? 2 : 0); return true;
    case 0x06: wel = true; return true;
    case 0x04: wel = false; return true;
    case 0x03:
      for (size_t i = 0; i < rxLen; i++) rx[i] = flash[(a + i) % LL_SAVE_SIZE];
      if (flakyEvery && ++reads % flakyEvery == 0 && rxLen) rx[rand() % rxLen] ^= 1 << (rand() % 8);
      return true;
  }
  if (busy || !wel) return true;   // a real chip ignores writes while busy or without write-enable
  wel = false;
  switch (cmd[0]) {
    case 0x0A: if (kind == M45PE) { program(a, tx, txLen, true); busyUntil = plat_ms() + 11 + slowMs; } return true;
    case 0x02: program(a, tx, txLen, false); busyUntil = plat_ms() + 2; return true;
    case 0xDB: if (kind == M45PE) { uint8_t ff[LL_PAGE]; memset(ff, 0xFF, sizeof ff); program(a & ~0xFFu, ff, LL_PAGE, true); busyUntil = plat_ms() + 10; } return true;
    case 0xD8: memset(flash + (a & ~0xFFFFu), 0xFF, 0x10000); busyUntil = plat_ms() + 300; return true;
  }
  return true;
}

const char *plat_sd_root(void) { return sdDir; }
// As the 3DS reports it: the wall-clock time the file was written, as if it were UTC.
int64_t plat_mtime(const char *full) {
  struct stat sb;
  if (stat(full, &sb)) return 0;
  struct tm tm; localtime_r(&sb.st_mtime, &tm);
  return (int64_t)sb.st_mtime + tm.tm_gmtoff;
}

bool plat_power_ok(char *why, size_t cap) {
  if (!lowBattery) return true;
  snprintf(why, cap, "The 3DS battery is low. Plug in the charger, then send the save again.");
  return false;
}
void plat_hold(bool busy) { (void)busy; }

// --abrupt-close: closing a socket throws away data not yet sent, as the 3DS's network stack can.
static bool abruptClose;
void plat_socket_opened(int fd) {
  if (!abruptClose) return;
  struct linger l = { 1, 0 };
  setsockopt(fd, SOL_SOCKET, SO_LINGER, &l, sizeof l);
}

bool plat_install_app(const uint8_t *d, size_t n, char *why, size_t cap) {
  char path[512];
  snprintf(path, sizeof path, "%s/3ds", sdDir); mkdir(sdDir, 0755); mkdir(path, 0755);
  snprintf(path, sizeof path, "%s/3ds/LeafletLink.3dsx", sdDir);
  FILE *f = fopen(path, "wb");
  bool ok = f && fwrite(d, 1, n, f) == n;
  if (f) ok = fclose(f) == 0 && ok;
  if (!ok) snprintf(why, cap, "The update couldn't be written to the SD card.");
  return ok;
}
static long clockShift;   // --clock-shift SECONDS: the simulated 3DS clock differs from this computer's
void plat_clock(char *out, size_t cap) { time_t t = time(NULL) + clockShift; strftime(out, cap, "%Y-%m-%d %H:%M:%S", localtime(&t)); }
void plat_stamp(char *out, size_t cap) { time_t t = time(NULL); strftime(out, cap, "%Y-%m-%d %H.%M.%S", localtime(&t)); }

static void flush_card(void) {
  if (!cardPath) return;
  FILE *f = fopen(cardPath, "wb");
  if (f) { fwrite(flash, 1, sizeof flash, f); fclose(f); }
}

int main(int argc, char **argv) {
  srand((unsigned)time(NULL));
  memset(flash, 0xFF, sizeof flash);
  for (int i = 1; i < argc; i++) {
    const char *a = argv[i], *v = i + 1 < argc ? argv[i + 1] : "";
    if (!strcmp(a, "--card")) { cardPath = v; i++; }
    else if (!strcmp(a, "--answer")) { snprintf(answer, sizeof answer, "%s", v); i++; }
    else if (!strcmp(a, "--chip")) { kind = !strcmp(v, "plain") ? PLAIN : !strcmp(v, "eeprom") ? EEPROM : !strcmp(v, "sanyo") ? SANYO : M45PE; i++; }
    else if (!strcmp(a, "--flaky-reads")) { flakyEvery = atoi(v); i++; }
    else if (!strcmp(a, "--stuck-page")) { stuckPage = strtol(v, NULL, 0) & ~0xFFL; i++; }
    else if (!strcmp(a, "--deaf-pages")) { deafLeft = atoi(v); i++; }
    else if (!strcmp(a, "--pull-at")) { pullAt = atoi(v); i++; }
    else if (!strcmp(a, "--low-battery")) lowBattery = true;
    else if (!strcmp(a, "--abrupt-close")) abruptClose = true;
    else if (!strcmp(a, "--clock-shift")) { clockShift = atol(v); i++; }
    else if (!strcmp(a, "--slow")) { slowMs = atoi(v); i++; }
    else if (!strcmp(a, "--sd")) { sdDir = v; i++; }
    else if (!strcmp(a, "--console")) consoleMenu = true;
    else { fprintf(stderr, "unknown option %s\n", a); return 2; }
  }
  if (cardPath) {
    FILE *f = fopen(cardPath, "rb");
    if (f) { size_t n = fread(flash, 1, sizeof flash, f); fclose(f); if (n < sizeof flash) fprintf(stderr, "note: card file is %zu bytes; the rest reads as blank\n", n); }
  }
  ll_init();
  if (!ll_net_start()) { fprintf(stderr, "couldn't listen on port %d\n", LL_PORT); return 1; }
  printf("Leaflet Link simulator on http://localhost:%d  (chip %s)\n", LL_PORT, kind == M45PE ? "m45pe" : kind == PLAIN ? "plain" : kind == SANYO ? "sanyo" : "eeprom");
  fflush(stdout);
  if (!strcmp(answer, "ask") || consoleMenu) fcntl(0, F_SETFL, fcntl(0, F_GETFL, 0) | O_NONBLOCK);
  char cmd[64]; size_t cmdLen = 0;
  LLState last = (LLState)-1;
  for (;;) {
    ll_net_poll();
    ll_tick();
    const LLStatus *s = ll_status();
    if (s->state != last) {
      last = s->state;
      printf("[%s] %s\n", s->title, s->message);
      fflush(stdout);
      if (s->state == LL_DONE || s->state == LL_FAILED) flush_card();
    }
    // The console's own menu, typed one command per line.
    char c;
    while (consoleMenu && read(0, &c, 1) == 1) {
      if (c != '\n') { if (cmdLen + 1 < sizeof cmd) cmd[cmdLen++] = c; continue; }
      cmd[cmdLen] = 0; cmdLen = 0;
      char why[240] = "";
      bool ok = true;
      if (!strcmp(cmd, "backup")) ok = ll_start_backup(why, sizeof why);
      else if (!strcmp(cmd, "health")) ok = ll_start_health(why, sizeof why);
      else if (!strcmp(cmd, "stop")) ll_answer(false);
      else if (!strcmp(cmd, "scan")) {
        int n; const LLSaveFile *l = ll_sd_list(&n); ll_sd_scan(); l = ll_sd_list(&n);
        for (int k = 0; k < n; k++) printf("save %d %s|%s|%s|%s|%s\n", k, l[k].path, l[k].town, l[k].residents, l[k].ok ? "ok" : "bad", l[k].backup ? "backup" : "game");
        printf("saves %d\n", n);
      } else if (!strncmp(cmd, "restore ", 8)) ok = ll_restore_from_sd(atoi(cmd + 8), why, sizeof why);
      if (!ok) printf("refused: %s\n", why);
      fflush(stdout);
    }
    if (s->state == LL_CONFIRM) {
      if (!strcmp(answer, "yes")) ll_answer(true);
      else if (!strcmp(answer, "no")) ll_answer(false);
      else if (!strcmp(answer, "delay")) { if (plat_ms() - s->since > 4000) ll_answer(true); }
      else if (!consoleMenu) { if (read(0, &c, 1) == 1 && (c == 'y' || c == 'n')) ll_answer(c == 'y'); }
    }
    usleep(s->state == LL_IDLE || s->state == LL_CONFIRM ? 5000 : 0);
  }
}
