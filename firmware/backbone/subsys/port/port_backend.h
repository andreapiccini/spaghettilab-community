#ifndef SPAGHETTI_PORT_BACKEND_H
#define SPAGHETTI_PORT_BACKEND_H

#include <spaghetti/port.h>

/**
 * @brief Apply the board-default pinctrl/backend for one transport.
 *
 * Receives the Port ID by value, does not retain owners, and does not manage
 * reference counts. Only @c port.c calls this after deciding the active transport.
 *
 * @param[in] port_id Port identifier.
 * @param[in] transport Selected electrical family.
 *
 * @retval 0 Backend applied.
 * @retval -ENOTSUP Transport is unavailable on this board.
 * @retval Negative errno from the board backend.
 */
int spaghetti_port_backend_select(
	spaghetti_port_id_t port_id,
	enum spaghetti_port_transport transport);

/**
 * @brief Return one Port to its board-defined safe/sleep wiring.
 *
 * On the current I2C-fixed Core this is a documented no-op.
 *
 * @param[in] port_id Port identifier.
 *
 * @retval 0 Safe state applied or intentionally skipped.
 * @retval Negative errno from the board backend.
 */
int spaghetti_port_backend_safe(spaghetti_port_id_t port_id);

#endif /* SPAGHETTI_PORT_BACKEND_H */
