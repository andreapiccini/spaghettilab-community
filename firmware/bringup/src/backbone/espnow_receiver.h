#pragma once

#include <stdint.h>

bool backbone_espnow_start(uint32_t node_id);
void backbone_espnow_poll();
bool backbone_espnow_ota_busy();

