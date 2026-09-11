#pragma once

#include <stddef.h>
#include <stdint.h>

bool core_espnow_begin(uint32_t node_id, uint32_t image_size, uint32_t image_crc32,
                       char *error, size_t error_cap);
bool core_espnow_write(uint32_t offset, const uint8_t *data, size_t length,
                       char *error, size_t error_cap);
bool core_espnow_finish(char *error, size_t error_cap);

