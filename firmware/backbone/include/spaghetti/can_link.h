/**
 * @file
 * @brief Event-driven typed runtime signals between physical Backbones.
 */
#ifndef SPAGHETTI_CAN_LINK_H
#define SPAGHETTI_CAN_LINK_H
#include <stdint.h>
#define SPAGHETTI_CAN_LINK_COMMAND 0x13U
/**
 * @brief Consume one bounded runtime signal fragment on the CAN worker thread.
 *
 * Invalid, incomplete and duplicate fragments do not emit a record.
 * @param frame Complete CAN payload including the command byte.
 * @param length Payload length in bytes (at most eight).
 */
void spaghetti_can_link_receive(const uint8_t *frame, uint8_t length);
#endif
