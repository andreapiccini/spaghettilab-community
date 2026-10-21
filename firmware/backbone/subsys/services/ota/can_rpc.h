#ifndef SPAGHETTI_CAN_RPC_H
#define SPAGHETTI_CAN_RPC_H
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#define SPAGHETTI_CAN_RPC_REQUEST 0x12U
#define SPAGHETTI_CAN_RPC_RESPONSE 0x92U
int spaghetti_can_rpc_exchange(uint32_t node, const uint8_t *request, size_t length,
                               uint8_t *response, size_t capacity, size_t *written);
void spaghetti_can_rpc_receive(uint32_t node, const uint8_t *frame, uint8_t dlc, bool response);
void spaghetti_can_rpc_service(void);
void spaghetti_field_update_service_wake(void);
bool spaghetti_can_rpc_operation_allowed(uint32_t operation);
#endif
