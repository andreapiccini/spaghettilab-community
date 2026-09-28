#include <zephyr/logging/log.h>

#include <spaghetti/core.h>

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

	LOG_INF("Spaghetti LAB engine running");
	return 0;
}
