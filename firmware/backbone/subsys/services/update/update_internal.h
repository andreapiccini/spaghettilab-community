#ifndef SPAGHETTI_UPDATE_INTERNAL_H
#define SPAGHETTI_UPDATE_INTERNAL_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#define SPAGHETTI_UPDATE_PROGRESS_ERASE 1U
#define SPAGHETTI_UPDATE_PROGRESS_WRITE 2U
#define SPAGHETTI_UPDATE_PROGRESS_VERIFY 3U

void spaghetti_update_notify_progress(uint8_t stage, uint8_t percent);

int spaghetti_update_backend_is_trial(bool *trial);
int spaghetti_update_backend_active_slot(uint8_t *slot);
int spaghetti_update_backend_get_capacity(size_t *out_size);
int spaghetti_update_backend_prepare(void);
int spaghetti_update_backend_write(uint32_t offset, const uint8_t *data,
				   size_t data_size, bool last);
int spaghetti_update_backend_finalize_test(void);
int spaghetti_update_backend_cancel(void);
int spaghetti_update_backend_confirm(void);

#endif /* SPAGHETTI_UPDATE_INTERNAL_H */
