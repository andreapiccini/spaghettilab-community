#ifndef SPAGHETTI_TEST_HWINFO_H
#define SPAGHETTI_TEST_HWINFO_H

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

ssize_t hwinfo_get_device_id(uint8_t *buffer, size_t length);

#endif /* SPAGHETTI_TEST_HWINFO_H */
