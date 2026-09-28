#include "port_backend.h"

#include <errno.h>

#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_port_backend,
		    CONFIG_SPAGHETTI_PORT_LOG_LEVEL);

int spaghetti_port_backend_select(
	spaghetti_port_id_t port_id,
	enum spaghetti_port_transport transport)
{
	ARG_UNUSED(port_id);

	/*
	 * Core V1 wires I2C and digital GPIO lines through static Devicetree
	 * pinctrl/gpio-cells — both are fixed per-Port wiring, not a runtime
	 * mux, so both may be selected and neither needs a pinctrl switch here.
	 * Anything else (SPI/UART/ADC/W1 sharing a runtime-switched bus) stays
	 * unsupported until a board variant actually describes it.
	 */
	if ((transport != SPAGHETTI_PORT_TRANSPORT_I2C) &&
	    (transport != SPAGHETTI_PORT_TRANSPORT_GPIO)) {
		return -ENOTSUP;
	}

	return 0;
}

int spaghetti_port_backend_safe(spaghetti_port_id_t port_id)
{
	ARG_UNUSED(port_id);

	/* I2C remains the fixed board wiring; safe-state is a documented no-op. */
	return 0;
}
