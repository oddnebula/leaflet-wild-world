// QR codes for Leaflet's address (qr.c).
#pragma once
#include <stdbool.h>
#include <stdint.h>
#define LL_QR_SIZE 29
// Fills out[y][x] (1 = dark) with text as a version 3-M QR code. False if text is longer than 42 bytes.
bool ll_qr(const char *text, uint8_t out[LL_QR_SIZE][LL_QR_SIZE]);
