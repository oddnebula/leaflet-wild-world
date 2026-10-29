// Leaflet Link core: everything that isn't specific to the 3DS, so the same code runs on the console and in the
// desktop simulator (link/host). It holds the save checks, the DS save-chip commands, the write engine and the small
// HTTP server Leaflet talks to.
#pragma once
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifndef LL_VERSION
#define LL_VERSION "1.2"
#endif
#define LL_PROTOCOL 1
#define LL_PORT 8226
#define LL_SAVE_SIZE 0x40000
#define LL_PAGE 0x100
#define LL_PAGES (LL_SAVE_SIZE / LL_PAGE)
#define LL_APP_MAX 0x400000   // largest Leaflet Link update accepted (a .3dsx)

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
// Writes a file under the app's backups folder and reads it back to check it. Puts the full path in path.
bool plat_save_backup(const char *name, const uint8_t *data, size_t n, char *path, size_t pathCap);
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
} LLState;

typedef struct {
  LLState state;
  float progress;         // 0..1 within the current state
  char town[40];          // the town being sent, as Leaflet named it
  char residents[80];
  char peer[48];          // address of the computer that sent it
  char title[64];         // short headline for the console screen
  char message[480];      // the full explanation
  char backup[160];       // where the copy of the cartridge's previous save is
  uint32_t job;           // Leaflet's id for this transfer
  int changed, written;   // pages that differ / pages written so far
  bool restored;          // after a failure: the original save is back and checked
  uint64_t since;         // when this state began (plat_ms)
  bool update;            // the job is a Leaflet Link update, not a save
  char version[16];       // the version being installed
  bool quit;              // after an update: close Leaflet Link when the person presses A, to open the new one
} LLStatus;

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
