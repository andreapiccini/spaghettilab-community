#ifndef SPAGHETTI_CONNECTIVITY_INTERNAL_H
#define SPAGHETTI_CONNECTIVITY_INTERNAL_H

#include <spaghetti/connectivity.h>

struct spaghetti_connectivity_backend {
	int (*start)(enum spaghetti_connectivity_service service);
	int (*stop)(enum spaghetti_connectivity_service service);
};

int spaghetti_connectivity_backend_install(
	const struct spaghetti_connectivity_backend *backend);

void spaghetti_connectivity_backend_reset(void);

#endif /* SPAGHETTI_CONNECTIVITY_INTERNAL_H */
