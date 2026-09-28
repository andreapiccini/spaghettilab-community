/**
 * @file
 * @brief Authoritative EEPROM Discovery provider (fake).
 */

#include "harness.h"

#include <errno.h>
#include <string.h>

#include <zephyr/kernel.h>

#include <spaghetti/discovery.h>
#include <spaghetti/port.h>
#include <spaghetti/power.h>
#include <spaghetti/topology.h>

static int fake_eeprom_scan(const struct spaghetti_port *port,
			    spaghetti_discovery_emit_candidate_cb_t emit,
			    void *emit_user_data, k_timeout_t timeout)
{
	struct v1_harness *h = v1_harness_get();
	struct spaghetti_discovery_candidate candidate;

	ARG_UNUSED(port);
	ARG_UNUSED(timeout);

	if (!h->eeprom_enabled || (h->eeprom_identity_size == 0U)) {
		return 0;
	}

	memset(&candidate, 0, sizeof(candidate));
	candidate.bay_id = SPAGHETTI_BAY_ID_UNSPECIFIED;
	candidate.power_rail_id = SPAGHETTI_POWER_RAIL_UNSPECIFIED;
	candidate.identity_size = (uint8_t)h->eeprom_identity_size;
	memcpy(candidate.identity, h->eeprom_identity, h->eeprom_identity_size);
	strncpy(candidate.suggested_type_id, "fake_temperature",
		sizeof(candidate.suggested_type_id) - 1U);
	return emit(&candidate, emit_user_data);
}

static const struct spaghetti_discovery_provider_ops ops = {
	.scan = fake_eeprom_scan,
};

SPAGHETTI_DISCOVERY_PROVIDER_DEFINE(fake_eeprom_provider) = {
	.provider_id = "v1.fake_eeprom",
	.api_version = SPAGHETTI_DISCOVERY_PROVIDER_API_VERSION,
	.method = SPAGHETTI_DISCOVERY_METHOD_EEPROM,
	.confidence = SPAGHETTI_DISCOVERY_AUTHORITATIVE,
	.probe_flags = SPAGHETTI_DISCOVERY_PROBE_READ_ONLY,
	.required_capabilities = SPAGHETTI_PORT_CAP_I2C,
	.ops = &ops,
};
