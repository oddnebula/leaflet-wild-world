// Leaflet Link core: everything that isn't specific to the 3DS, so the same code runs on the console and in the
// desktop simulator (link/host). It holds the save checks, the DS save-chip commands, the write engine and the small
// HTTP server Leaflet talks to.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef LL_VERSION
#define LL_VERSION "1.3.1"
#endif
#define LL_PROTOCOL 1
#define LL_PORT 8226
#define LL_SAVE_SIZE 0x40000
#define LL_PAGE 0x100
#define LL_PAGES (LL_SAVE_SIZE / LL_PAGE)
#define LL_APP_MAX 0x400000   // largest Leaflet Link update accepted (a .3dsx)
#define LL_FILE_MAX 0x100000  // largest save file looked at on the SD card (flashcarts and nds-bootstrap pad some saves)
#define LL_BACKUP_DIR "/3ds/LeafletLink/backups"   // on the SD card
#define LL_SD_MAX 64          // saves listed from the SD card

// ---- provided by the platform (main_3ds.c or host/sim.c) ----------------------------------------------------------
typedef struct {
  bool present;     // something is in the game card slot
  bool ds;          // it is a DS game card (not a 3DS one)
  char code[5];     // game code from the card header, e.g. "ADME"
  char title[13];   // header title, e.g. "ANIMALCROSSW"
} LLCard;

// One transfer on the save chip's SPI bus with chip-select held: send cmd, then read rxLen bytes into rx, then send
// txLen bytes from tx. Returns false if the console couldn't talk to the card.
bool plat_spi(const uint8_t *cmd, size_t cmdLen, uint8_t *rx, size_t rxLen, const uint8_t *tx, size_t txLen);
void plat_card(LLCard *c);
uint64_t plat_ms(void);
// The SD card's root as stdio sees it ("sdmc:" on the 3DS); paths below it start with "/".
const char *plat_sd_root(void);
// A file's modified time (seconds since 1970, on the console's clock), or 0 if unknown.
int64_t plat_mtime(const char *fullPath);
// False (with a reason) when the battery is too low to start writing.
bool plat_power_ok(char *why, size_t cap);
// While busy, the HOME button and sleep are held off so a write can't be interrupted by accident.
void plat_hold(bool busy);
void plat_stamp(char *out, size_t cap);   // local time as "2026-10-28 14.03.22"
// The system's clock as the DS game sees it (wall-clock time, no time zone): "2026-10-28 14:03:22".
void plat_clock(char *out, size_t cap);
// Replaces the Leaflet Link app on the SD card with a new .3dsx: written to a temporary file, read back, then swapped
// in, so a failed update leaves the old app in place.
bool plat_install_app(const uint8_t *d, size_t n, char *why, size_t cap);
// Called for each new connection (the simulator uses it to imitate the 3DS's network stack).
void plat_socket_opened(int fd);

// ---- core ---------------------------------------------------------------------------------------------------------
typedef enum {
  LL_IDLE,        // waiting for Leaflet
  LL_CONFIRM,     // a save arrived and passed its checks; waiting for the person to press A or B
  LL_BACKUP,      // reading what's on the cartridge now and keeping a copy on the SD card
  LL_WRITING,
  LL_VERIFYING,   // reading the whole cartridge back and comparing it byte for byte
  LL_RESTORING,   // something went wrong: putting the original save back
  LL_DONE,
  LL_FAILED,
  LL_UPDATING,    // installing a new Leaflet Link sent by Leaflet
  LL_CHECKING,    // the health check: reading the save chip again and again (never writes)
} LLState;

// What the current (or last) job is.
typedef enum {
  LL_JOB_CARD,    // a save to the game card (from Leaflet, or from the SD card on the console)
  LL_JOB_UPDATE,  // a new Leaflet Link
  LL_JOB_SDFILE,  // a save to a game's save file on the SD card (TWiLight Menu++, nds-bootstrap forwarders)
  LL_JOB_BACKUP,  // the console's own "Back up": the game card's save copied to the SD card
  LL_JOB_HEALTH,  // the console's or Leaflet's health check
} LLJob;

typedef struct {
  LLState state;
  float progress;         // 0..1 within the current state
  char town[40];          // the town being sent, as Leaflet named it
  char residents[80];
  char peer[48];          // address of the computer that sent it
  char title[64];         // short headline for the console screen
  char message[480];      // the full explanation
  char backup[220];       // where the copy of the cartridge's previous save is
  uint32_t job;           // Leaflet's id for this transfer
  int changed, written;   // pages that differ / pages written so far
  bool restored;          // after a failure: the original save is back and checked
  uint64_t since;         // when this state began (plat_ms)
  bool update;            // the job is a Leaflet Link update, not a save
  char version[16];       // the version being installed
  bool quit;              // after an update: close Leaflet Link when the person presses A, to open the new one
  LLJob kind;
  char source[96];        // where the save comes from, when it isn't Leaflet ("Animal Crossing.sav on the SD card")
  char target[160];       // LL_JOB_SDFILE: the save file being replaced, from the SD card's root
  bool caution;           // a finished job worth a second look, though nothing went wrong (health check findings)
} LLStatus;

// A Wild World save found on the SD card.
typedef struct {
  char path[160];         // from the SD card's root: "/roms/nds/saves/Animal Crossing - Wild World.sav"
  char town[40];          // UTF-8
  char residents[100];
  uint32_t size;
  int64_t mtime;          // when it was saved (console clock, seconds since 1970)
  uint8_t region;         // 0x8A USA, 0xC5 Europe
  bool ok;                // passes every checksum the game checks
  bool backup;            // one of Leaflet Link's own backups (otherwise a game's save file)
} LLSaveFile;

// Result of the health check.
typedef struct {
  int passes;             // full reads made
  int unstable;           // 4 KB areas that didn't read the same every time (of 64)
  int flips;              // bits that differed between reads, in all
  uint32_t firstBad;      // address of the first unstable area
  bool idStable;          // the chip gave the same ID every time
  int check;              // ll_check_save on what was read (0 = healthy save)
  char checkWhy[160];
  bool blank;             // never saved
  uint32_t ms;            // how long it took
} LLHealth;

typedef struct {
  bool answered;          // the chip answered its ID command
  uint8_t id[3];
  uint32_t size;          // capacity from the ID, 0 if unknown
  bool writable;          // the kind of chip Wild World uses (256 KB flash)
  char why[120];          // why not, when it isn't
} LLChip;

void ll_init(void);
void ll_tick(void);                // runs a slice of any job in progress; call every frame
void ll_answer(bool yes);          // the person's answer on the console (A / B), also dismisses DONE / FAILED
const LLStatus *ll_status(void);
const LLCard *ll_card(void);       // the card as last seen (refreshed twice a second)
const LLChip *ll_chip(void);
bool ll_card_ready(char *why, size_t cap);   // a Wild World card is in and its save chip answers

// The console's own menu. Each returns false with the reason when it can't start.
bool ll_start_backup(char *why, size_t cap);   // copy the game card's save to the SD card
bool ll_start_health(char *why, size_t cap);   // read-only check of the save chip
// Finds Wild World saves on the SD card: Leaflet Link's backups, and the save files of TWiLight Menu++,
// nds-bootstrap forwarders and other DS homebrew loaders. Newest first.
int ll_sd_scan(void);                // the whole search at once
void ll_sd_scan_begin(void);         // or a slice at a time: ll_tick carries it on
bool ll_sd_scan_step(uint32_t ms);
bool ll_sd_scanning(void);
const LLSaveFile *ll_sd_list(int *n);
// Offers a save from the SD card for the game card: checked, then the person confirms, as with a save from Leaflet.
bool ll_restore_from_sd(int index, char *why, size_t cap);
const LLHealth *ll_health(void);

// HTTP server for Leaflet (port LL_PORT). Non-blocking: call ll_net_poll every frame.
bool ll_net_start(void);
void ll_net_poll(void);
void ll_net_stop(void);

// Save checks, shared with the tests.
uint32_t ll_crc32(const uint8_t *d, size_t n);
// 0 = a complete, healthy Wild World save (both copies of the town and the town hall letters pass their checksums).
// Otherwise a short reason is written to why.
int ll_check_save(const uint8_t *d, char *why, size_t cap);
bool ll_save_blank(const uint8_t *d);   // never saved: every byte is 0xFF
int ll_save_region(const uint8_t *d);   // 0x8A USA, 0xC5 Europe, 0 unknown
// The town's name and residents (UTF-8), from whichever copy of the town is healthy.
void ll_describe(const uint8_t *d, char *town, size_t townCap, char *residents, size_t resCap);
