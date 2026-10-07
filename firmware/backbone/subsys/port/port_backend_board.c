#include "port_backend.h"

#include <errno.h>
#include <string.h>
#include <zephyr/drivers/gpio.h>
#if defined(CONFIG_SOC_ESP32S3)
#include <esp_rom_gpio.h>
#include <soc/gpio_sig_map.h>
#endif

#include <zephyr/logging/log.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/pinctrl.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_port_backend,
		    CONFIG_SPAGHETTI_PORT_LOG_LEVEL);

static uint8_t user_modes[4];
static uint8_t user_config[20];
int spaghetti_port_backend_user_map(spaghetti_port_id_t id, const uint8_t modes[4], const uint8_t config[20])
{
#if defined(CONFIG_SOC_ESP32S3) && DT_HAS_COMPAT_STATUS_OKAY(spaghettilab_physical_backbone)
	const uint8_t user_id = DT_REG_ADDR(DT_PHANDLE(DT_COMPAT_GET_ANY_STATUS_OKAY(spaghettilab_physical_backbone), user_port));
	if (id != user_id) return -ENOTSUP;
	const struct device *gpio = DEVICE_DT_GET(DT_NODELABEL(gpio1));
	for (uint8_t i = 0; i < 4; ++i) {
		const uint32_t pin = 38U - i;
		uint32_t input = UINT32_MAX, output = UINT32_MAX;
		gpio_flags_t flags = GPIO_INPUT;
		switch (modes[i] & 15U) {
		case 4: input = I2CEXT0_SDA_IN_IDX; output = I2CEXT0_SDA_OUT_IDX; flags = GPIO_INPUT | GPIO_OUTPUT | GPIO_OPEN_DRAIN | GPIO_PULL_UP; break;
		case 5: input = I2CEXT0_SCL_IN_IDX; output = I2CEXT0_SCL_OUT_IDX; flags = GPIO_INPUT | GPIO_OUTPUT | GPIO_OPEN_DRAIN | GPIO_PULL_UP; break;
		case 6: output = U2TXD_OUT_IDX; flags = GPIO_OUTPUT_HIGH; break;
		case 7: input = U2RXD_IN_IDX; flags = GPIO_INPUT | GPIO_PULL_UP; break;
		case 8: output = SPI3_CLK_OUT_IDX; flags = GPIO_OUTPUT_LOW; break;
		case 9: output = SPI3_D_OUT_IDX; flags = GPIO_OUTPUT_LOW; break;
		case 10: input = SPI3_Q_IN_IDX; break;
		case 11: flags = GPIO_OUTPUT_HIGH; break;
		case 12: output = LEDC_LS_SIG_OUT0_IDX + i; flags = GPIO_OUTPUT_LOW; break;
		default: continue;
		}
		int err = gpio_pin_configure(gpio, pin - 32U, flags);
		if (err) return err;
		if (input != UINT32_MAX) esp_rom_gpio_connect_in_signal(pin, input, false);
		if (output != UINT32_MAX) esp_rom_gpio_connect_out_signal(pin, output, false, false);
	}
	memcpy(user_modes, modes, 4U); memcpy(user_config, config, 20U);
	return 0;
#else
	ARG_UNUSED(config);
	for (uint8_t i = 0; i < 4; ++i) if ((modes[i] & 15U) > 5U) return -ENOTSUP;
	return spaghetti_port_backend_select(id, SPAGHETTI_PORT_TRANSPORT_GPIO);
#endif
}

#if !defined(CONFIG_PINCTRL_NON_STATIC)
#define SPAGHETTI_PORT_I2C_PINCTRL(node_id) PINCTRL_DT_DEFINE(node_id);
#else
#define SPAGHETTI_PORT_I2C_PINCTRL(node_id) PINCTRL_DT_DEV_CONFIG_DECLARE(node_id);
#endif
DT_FOREACH_STATUS_OKAY(espressif_esp32_i2c, SPAGHETTI_PORT_I2C_PINCTRL)

#define SPAGHETTI_PORT_RESTORE_I2C(node_id) \
	COND_CODE_1(DT_NODE_HAS_PROP(node_id, i2c), \
		(if (port_id == DT_REG_ADDR(node_id)) { \
			return pinctrl_apply_state(PINCTRL_DT_DEV_CONFIG_GET( \
				DT_PHANDLE(node_id, i2c)), PINCTRL_STATE_DEFAULT); \
		}), ())

int spaghetti_port_backend_select(
	spaghetti_port_id_t port_id,
	enum spaghetti_port_transport transport)
{
	if (port_id == 0U && user_config[0] == 1U && transport != SPAGHETTI_PORT_TRANSPORT_GPIO) {
		uint8_t modes[4], config[20]; memcpy(modes, user_modes, 4U); memcpy(config, user_config, 20U);
		return spaghetti_port_backend_user_map(port_id, modes, config);
	}
	if (transport == SPAGHETTI_PORT_TRANSPORT_I2C) {
		DT_FOREACH_STATUS_OKAY(spaghettilab_port, SPAGHETTI_PORT_RESTORE_I2C)
		return -ENOTSUP;
	}
	ARG_UNUSED(port_id);

	/*
	 * Core V1 wires I2C and digital GPIO lines through static Devicetree
	 * pinctrl/gpio-cells. Selecting I2C above restores its pinctrl state
	 * after manual GPIO configuration of the shared user pins.
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
