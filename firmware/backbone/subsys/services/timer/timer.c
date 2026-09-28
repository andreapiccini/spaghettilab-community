#include <spaghetti/timer.h>

#include <errno.h>
#include <stdbool.h>

#include <zephyr/kernel.h>
#include <zephyr/sys/util.h>

static struct k_sem *runtime_tick_sem;
static bool is_initialized;
static bool is_running;
K_MUTEX_DEFINE(timer_lock);

static void runtime_timer_expiry(struct k_timer *timer)
{
	ARG_UNUSED(timer);
	k_sem_give(runtime_tick_sem);
}

K_TIMER_DEFINE(runtime_timer, runtime_timer_expiry, NULL);

int spaghetti_timer_init(struct k_sem *tick_sem)
{
	int err;

	if (tick_sem == NULL) {
		return -EINVAL;
	}

	err = k_mutex_lock(&timer_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (is_initialized) {
		k_mutex_unlock(&timer_lock);
		return -EALREADY;
	}

	runtime_tick_sem = tick_sem;
	is_running = false;
	is_initialized = true;
	k_mutex_unlock(&timer_lock);
	return 0;
}

int spaghetti_timer_start(uint32_t period_ms)
{
	int err;

	if (period_ms == 0U) {
		return -EINVAL;
	}

	err = k_mutex_lock(&timer_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (!is_initialized) {
		err = -EACCES;
		goto unlock;
	}
	if (is_running) {
		err = -EALREADY;
		goto unlock;
	}

	is_running = true;
	k_timer_start(&runtime_timer, K_MSEC(period_ms), K_MSEC(period_ms));
	err = 0;

unlock:
	k_mutex_unlock(&timer_lock);
	return err;
}

int spaghetti_timer_stop(void)
{
	int err = k_mutex_lock(&timer_lock, K_FOREVER);

	if (err < 0) {
		return err;
	}
	if (!is_initialized) {
		k_mutex_unlock(&timer_lock);
		return -EACCES;
	}

	if (is_running) {
		k_timer_stop(&runtime_timer);
		is_running = false;
	}
	k_mutex_unlock(&timer_lock);
	return 0;
}
