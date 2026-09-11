#pragma once

#include "pb_lite.h"

typedef void (*C3FlashProgressFn)(const char *msg);

// ROM SLIP sync is stepped from loop() so USB CDC stays alive.
// start() returns 1 = finished now, 0 = poll(), -1 = immediate fail.
int c3_flash_begin_start(const HostMsg &msg, char *err, size_t err_cap,
                         C3FlashProgressFn progress = nullptr);
bool c3_flash_begin_poll(uint32_t *mode_used, char *err, size_t err_cap, bool *ok);
bool c3_flash_chunk(const HostMsg &msg, uint32_t *progress_pct, char *err, size_t err_cap);
bool c3_flash_finish(char *err, size_t err_cap);
bool c3_reboot(bool enter_update, bool rom_download, uint32_t node_id, bool addressed,
               char *err, size_t err_cap);
bool c3_twai_alive(uint32_t node_id, bool addressed, uint32_t timeout_ms);
