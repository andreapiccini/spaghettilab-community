#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>

#include <spaghetti/core.h>
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
#include <spaghetti/field_update.h>
#endif

LOG_MODULE_REGISTER(spaghetti_app, CONFIG_SPAGHETTI_APP_LOG_LEVEL);

int main(void)
{
	int err = spaghetti_core_init();

	if (err < 0) {
		LOG_ERR("Spaghetti LAB initialization failed: %d", err);
		return err;
	}

	err = spaghetti_core_start();
	if (err < 0) {
		LOG_ERR("Spaghetti LAB start failed: %d", err);
		return err;
	}

	LOG_INF("%s running", IS_ENABLED(CONFIG_SPAGHETTI_NFC_MODULE) ?
		"Spaghetti NFC CAN peripheral" : "Spaghetti LAB engine");
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
 if (!IS_ENABLED(CONFIG_SPAGHETTI_NFC_MODULE)) spaghetti_field_update_identify_service();
#endif
	k_sleep(K_FOREVER);
	return 0;
}
