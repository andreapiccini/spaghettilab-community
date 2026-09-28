#include <spaghetti/record_delivery.h>

SPAGHETTI_RECORD_CONSUMER_DEFINE(spaghetti_ble_record_consumer) = {
	.id = SPAGHETTI_RECORD_CONSUMER_ID_BLE,
	.name = "ble",
};
