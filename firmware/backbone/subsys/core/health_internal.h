#ifndef SPAGHETTI_HEALTH_INTERNAL_H
#define SPAGHETTI_HEALTH_INTERNAL_H

#include <stdbool.h>
#include <stdint.h>

#include <spaghetti/core.h>
#include <spaghetti/health.h>

typedef enum spaghetti_core_mode (*spaghetti_health_mode_getter_t)(void);

struct spaghetti_health_watchdog_backend {
	int (*setup)(uint32_t timeout_ms);
	int (*feed)(void);
};

int spaghetti_health_watchdog_backend_install(
	const struct spaghetti_health_watchdog_backend *backend);

void spaghetti_health_set_mode_getter(spaghetti_health_mode_getter_t getter);

void spaghetti_health_reset(void);

uint32_t spaghetti_health_test_supervisor_feed_count(void);

void spaghetti_health_test_poll(void);

#endif /* SPAGHETTI_HEALTH_INTERNAL_H */
