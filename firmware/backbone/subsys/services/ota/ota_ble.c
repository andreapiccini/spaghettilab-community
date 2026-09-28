#include <spaghetti/ota.h>

#include <errno.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

#include <spaghetti/runtime.h>
#include <spaghetti/update.h>
#include <spaghetti/ble.h>

LOG_MODULE_REGISTER(spaghetti_ota_ble, CONFIG_SPAGHETTI_OTA_LOG_LEVEL);

#ifndef CONFIG_SPAGHETTI_OTA_BLE_RESUME_MS
#define CONFIG_SPAGHETTI_OTA_BLE_RESUME_MS 10000
#endif

#ifndef CONFIG_SPAGHETTI_OTA_BLE_WINDOW_MS
#define CONFIG_SPAGHETTI_OTA_BLE_WINDOW_MS 300000
#endif

#ifndef CONFIG_SPAGHETTI_RUNTIME_STOP_TIMEOUT_MS
#define CONFIG_SPAGHETTI_RUNTIME_STOP_TIMEOUT_MS 1000
#endif

enum spaghetti_ota_ble_phase {
	SPAGHETTI_OTA_BLE_IDLE = 0,
	SPAGHETTI_OTA_BLE_ACTIVE,
	SPAGHETTI_OTA_BLE_RESUME_WAIT,
};

struct spaghetti_ota_ble_sha256 {
	uint32_t state[8];
	uint64_t bit_len;
	uint8_t buffer[64];
	size_t buffer_len;
};

struct spaghetti_ota_ble_session {
	enum spaghetti_ota_ble_phase phase;
	uint32_t session_id;
	uint32_t expected_offset;
	uint32_t image_size;
	uint8_t image_sha256[32];
	char version[SPAGHETTI_CORE_VERSION_SIZE];
	struct spaghetti_ota_ble_sha256 digest;
	bool runtime_quiesced;
};

static struct spaghetti_ota_ble_session session;
static spaghetti_principal_id_t acting_principal_id;
static uint32_t next_session_id = 1U;
static struct k_work_delayable resume_work;
static bool resume_work_ready;
K_MUTEX_DEFINE(ota_ble_lock);

static uint32_t sha256_rotr(uint32_t value, uint32_t bits)
{
	return (value >> bits) | (value << (32U - bits));
}

static void sha256_transform(uint32_t state[8], const uint8_t block[64])
{
	static const uint32_t k[64] = {
		0x428a2f98U, 0x71374491U, 0xb5c0fbcfU, 0xe9b5dba5U,
		0x3956c25bU, 0x59f111f1U, 0x923f82a4U, 0xab1c5ed5U,
		0xd807aa98U, 0x12835b01U, 0x243185beU, 0x550c7dc3U,
		0x72be5d74U, 0x80deb1feU, 0x9bdc06a7U, 0xc19bf174U,
		0xe49b69c1U, 0xefbe4786U, 0x0fc19dc6U, 0x240ca1ccU,
		0x2de92c6fU, 0x4a7484aaU, 0x5cb0a9dcU, 0x76f988daU,
		0x983e5152U, 0xa831c66dU, 0xb00327c8U, 0xbf597fc7U,
		0xc6e00bf3U, 0xd5a79147U, 0x06ca6351U, 0x14292967U,
		0x27b70a85U, 0x2e1b2138U, 0x4d2c6dfcU, 0x53380d13U,
		0x650a7354U, 0x766a0abbU, 0x81c2c92eU, 0x92722c85U,
		0xa2bfe8a1U, 0xa81a664bU, 0xc24b8b70U, 0xc76c51a3U,
		0xd192e819U, 0xd6990624U, 0xf40e3585U, 0x106aa070U,
		0x19a4c116U, 0x1e376c08U, 0x2748774cU, 0x34b0bcb5U,
		0x391c0cb3U, 0x4ed8aa4aU, 0x5b9cca4fU, 0x682e6ff3U,
		0x748f82eeU, 0x78a5636fU, 0x84c87814U, 0x8cc70208U,
		0x90befffaU, 0xa4506cebU, 0xbef9a3f7U, 0xc67178f2U,
	};
	uint32_t w[64];
	uint32_t a = state[0];
	uint32_t b = state[1];
	uint32_t c = state[2];
	uint32_t d = state[3];
	uint32_t e = state[4];
	uint32_t f = state[5];
	uint32_t g = state[6];
	uint32_t h = state[7];

	for (size_t idx = 0U; idx < 16U; ++idx) {
		w[idx] = ((uint32_t)block[idx * 4U] << 24) |
			 ((uint32_t)block[(idx * 4U) + 1U] << 16) |
			 ((uint32_t)block[(idx * 4U) + 2U] << 8) |
			 (uint32_t)block[(idx * 4U) + 3U];
	}
	for (size_t idx = 16U; idx < 64U; ++idx) {
		const uint32_t s0 = sha256_rotr(w[idx - 15U], 7U) ^
				    sha256_rotr(w[idx - 15U], 18U) ^
				    (w[idx - 15U] >> 3U);
		const uint32_t s1 = sha256_rotr(w[idx - 2U], 17U) ^
				    sha256_rotr(w[idx - 2U], 19U) ^
				    (w[idx - 2U] >> 10U);

		w[idx] = w[idx - 16U] + s0 + w[idx - 7U] + s1;
	}
	for (size_t idx = 0U; idx < 64U; ++idx) {
		const uint32_t s1 = sha256_rotr(e, 6U) ^ sha256_rotr(e, 11U) ^
				    sha256_rotr(e, 25U);
		const uint32_t ch = (e & f) ^ ((~e) & g);
		const uint32_t temp1 = h + s1 + ch + k[idx] + w[idx];
		const uint32_t s0 = sha256_rotr(a, 2U) ^ sha256_rotr(a, 13U) ^
				    sha256_rotr(a, 22U);
		const uint32_t maj = (a & b) ^ (a & c) ^ (b & c);
		const uint32_t temp2 = s0 + maj;

		h = g;
		g = f;
		f = e;
		e = d + temp1;
		d = c;
		c = b;
		b = a;
		a = temp1 + temp2;
	}
	state[0] += a;
	state[1] += b;
	state[2] += c;
	state[3] += d;
	state[4] += e;
	state[5] += f;
	state[6] += g;
	state[7] += h;
}

static void sha256_init(struct spaghetti_ota_ble_sha256 *ctx)
{
	ctx->state[0] = 0x6a09e667U;
	ctx->state[1] = 0xbb67ae85U;
	ctx->state[2] = 0x3c6ef372U;
	ctx->state[3] = 0xa54ff53aU;
	ctx->state[4] = 0x510e527fU;
	ctx->state[5] = 0x9b05688cU;
	ctx->state[6] = 0x1f83d9abU;
	ctx->state[7] = 0x5be0cd19U;
	ctx->bit_len = 0U;
	ctx->buffer_len = 0U;
}

static void sha256_update(struct spaghetti_ota_ble_sha256 *ctx,
			  const uint8_t *data, size_t size)
{
	size_t offset = 0U;

	while (offset < size) {
		const size_t space = 64U - ctx->buffer_len;
		const size_t copy = MIN(space, size - offset);

		memcpy(&ctx->buffer[ctx->buffer_len], &data[offset], copy);
		ctx->buffer_len += copy;
		offset += copy;
		if (ctx->buffer_len == 64U) {
			sha256_transform(ctx->state, ctx->buffer);
			ctx->bit_len += 512U;
			ctx->buffer_len = 0U;
		}
	}
}

static void sha256_finish(struct spaghetti_ota_ble_sha256 *ctx, uint8_t out[32])
{
	uint8_t block[64];
	size_t idx;

	ctx->bit_len += (uint64_t)ctx->buffer_len * 8U;
	memcpy(block, ctx->buffer, ctx->buffer_len);
	block[ctx->buffer_len] = 0x80U;
	for (idx = ctx->buffer_len + 1U; idx < 64U; ++idx) {
		block[idx] = 0U;
	}
	if (ctx->buffer_len >= 56U) {
		sha256_transform(ctx->state, block);
		memset(block, 0, sizeof(block));
	}
	for (idx = 0U; idx < 8U; ++idx) {
		block[63U - idx] = (uint8_t)(ctx->bit_len >> (idx * 8U));
	}
	sha256_transform(ctx->state, block);
	for (idx = 0U; idx < 8U; ++idx) {
		out[(idx * 4U)] = (uint8_t)(ctx->state[idx] >> 24);
		out[(idx * 4U) + 1U] = (uint8_t)(ctx->state[idx] >> 16);
		out[(idx * 4U) + 2U] = (uint8_t)(ctx->state[idx] >> 8);
		out[(idx * 4U) + 3U] = (uint8_t)ctx->state[idx];
	}
}

static void clear_session_locked(void)
{
	(void)k_work_cancel_delayable(&resume_work);
	memset(&session, 0, sizeof(session));
	session.phase = SPAGHETTI_OTA_BLE_IDLE;
}

static int authorize_open_locked(void)
{
	spaghetti_principal_id_t principal_id = acting_principal_id;
	int err;

	if (principal_id != 0U) {
		return spaghetti_principal_authorize(
			principal_id, SPAGHETTI_PERMISSION_UPDATE);
	}
	err = spaghetti_ble_find_update_principal(&principal_id);
	if (err < 0) {
		return (err == -ENOENT) ? -EACCES : err;
	}
	return spaghetti_principal_authorize(
		principal_id, SPAGHETTI_PERMISSION_UPDATE);
}

static int quiesce_runtime_locked(void)
{
	const int err = spaghetti_runtime_stop(
		K_MSEC(CONFIG_SPAGHETTI_RUNTIME_STOP_TIMEOUT_MS));

	if ((err == 0) || (err == -EALREADY) || (err == -EACCES)) {
		session.runtime_quiesced = true;
		return 0;
	}
	return err;
}

static int cancel_update_locked(void)
{
	const int err = spaghetti_update_cancel();

	if ((err == 0) || (err == -EALREADY)) {
		return 0;
	}
	return err;
}

static void resume_timeout_handler(struct k_work *work)
{
	int err;

	ARG_UNUSED(work);
	(void)k_mutex_lock(&ota_ble_lock, K_FOREVER);
	if (session.phase != SPAGHETTI_OTA_BLE_RESUME_WAIT) {
		k_mutex_unlock(&ota_ble_lock);
		return;
	}
	err = cancel_update_locked();
	if (err < 0) {
		LOG_ERR("BLE resume timeout cancel failed: err=%d", err);
	} else {
		LOG_WRN("BLE OTA resume expired; candidate discarded");
	}
	clear_session_locked();
	k_mutex_unlock(&ota_ble_lock);
}

static void ensure_resume_work(void)
{
	if (!resume_work_ready) {
		k_work_init_delayable(&resume_work, resume_timeout_handler);
		resume_work_ready = true;
	}
}

static bool version_is_valid(const char *version)
{
	size_t len = 0U;

	if (version[0] == '\0') {
		return false;
	}
	while ((len < SPAGHETTI_CORE_VERSION_SIZE) && (version[len] != '\0')) {
		++len;
	}
	return len < SPAGHETTI_CORE_VERSION_SIZE;
}

static int clear_resume_locked(void)
{
	if (session.phase == SPAGHETTI_OTA_BLE_RESUME_WAIT) {
		(void)k_work_cancel_delayable(&resume_work);
		session.phase = SPAGHETTI_OTA_BLE_ACTIVE;
	}
	return 0;
}

void spaghetti_ota_ble_set_acting_principal(spaghetti_principal_id_t id)
{
	(void)k_mutex_lock(&ota_ble_lock, K_FOREVER);
	acting_principal_id = id;
	k_mutex_unlock(&ota_ble_lock);
}

void spaghetti_ota_ble_on_disconnect(void)
{
	(void)k_mutex_lock(&ota_ble_lock, K_FOREVER);
	ensure_resume_work();
	if (session.phase == SPAGHETTI_OTA_BLE_ACTIVE) {
		session.phase = SPAGHETTI_OTA_BLE_RESUME_WAIT;
		(void)k_work_reschedule(
			&resume_work,
			K_MSEC(CONFIG_SPAGHETTI_OTA_BLE_RESUME_MS));
		LOG_INF("BLE disconnect; resume_ms=%u session=%u",
			CONFIG_SPAGHETTI_OTA_BLE_RESUME_MS, session.session_id);
	}
	k_mutex_unlock(&ota_ble_lock);
}

int spaghetti_ota_ble_open(
	const struct spaghetti_ble_update_begin *request,
	uint32_t *session_id)
{
	size_t capacity = 0U;
	int err;

	if ((request == NULL) || (session_id == NULL) ||
	    (request->image_size == 0U) ||
	    !version_is_valid(request->version)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ota_ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	ensure_resume_work();
	if (session.phase != SPAGHETTI_OTA_BLE_IDLE) {
		err = -EBUSY;
		goto unlock;
	}

	err = authorize_open_locked();
	if (err < 0) {
		goto unlock;
	}

	err = spaghetti_update_get_capacity(&capacity);
	if (err < 0) {
		goto unlock;
	}
	if (request->image_size > capacity) {
		err = -EFBIG;
		goto unlock;
	}

	err = quiesce_runtime_locked();
	if (err < 0) {
		goto unlock;
	}

	err = spaghetti_update_arm(CONFIG_SPAGHETTI_OTA_BLE_WINDOW_MS);
	if (err < 0) {
		goto unlock;
	}
	err = spaghetti_update_begin(SPAGHETTI_UPDATE_TRANSPORT_BLE);
	if (err < 0) {
		(void)cancel_update_locked();
		goto unlock;
	}

	if (next_session_id == 0U) {
		next_session_id = 1U;
	}
	session.phase = SPAGHETTI_OTA_BLE_ACTIVE;
	session.session_id = next_session_id++;
	session.expected_offset = 0U;
	session.image_size = request->image_size;
	memcpy(session.image_sha256, request->image_sha256,
	       sizeof(session.image_sha256));
	memcpy(session.version, request->version, sizeof(session.version));
	session.version[SPAGHETTI_CORE_VERSION_SIZE - 1U] = '\0';
	sha256_init(&session.digest);
	*session_id = session.session_id;
	err = 0;
	LOG_INF("BLE update open: session=%u size=%u version=%s",
		session.session_id, session.image_size, session.version);

unlock:
	k_mutex_unlock(&ota_ble_lock);
	return err;
}

int spaghetti_ota_ble_write(uint32_t session_id, uint32_t offset,
			    const uint8_t *bytes, size_t size)
{
	bool last;
	int err;

	if ((session_id == 0U) || (bytes == NULL) || (size == 0U) ||
	    (size > SPAGHETTI_OTA_BLE_CHUNK_MAX)) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ota_ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if ((session.phase != SPAGHETTI_OTA_BLE_ACTIVE) &&
	    (session.phase != SPAGHETTI_OTA_BLE_RESUME_WAIT)) {
		err = -EPERM;
		goto unlock;
	}
	if (session.session_id != session_id) {
		err = -ENOENT;
		goto unlock;
	}
	if (offset != session.expected_offset) {
		err = -EINVAL;
		goto unlock;
	}
	if ((offset > session.image_size) ||
	    (size > (session.image_size - offset))) {
		err = -EINVAL;
		goto unlock;
	}

	(void)clear_resume_locked();
	last = ((offset + (uint32_t)size) == session.image_size);
	err = spaghetti_update_write(offset, bytes, size, last);
	if (err < 0) {
		goto unlock;
	}
	sha256_update(&session.digest, bytes, size);
	session.expected_offset = offset + (uint32_t)size;
	err = 0;

unlock:
	k_mutex_unlock(&ota_ble_lock);
	return err;
}

int spaghetti_ota_ble_finish(uint32_t session_id)
{
	uint8_t digest[32];
	int err;

	if (session_id == 0U) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ota_ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if ((session.phase != SPAGHETTI_OTA_BLE_ACTIVE) &&
	    (session.phase != SPAGHETTI_OTA_BLE_RESUME_WAIT)) {
		err = -EPERM;
		goto unlock;
	}
	if (session.session_id != session_id) {
		err = -ENOENT;
		goto unlock;
	}
	if (session.expected_offset != session.image_size) {
		err = -EBADMSG;
		goto unlock;
	}

	(void)clear_resume_locked();
	sha256_finish(&session.digest, digest);
	if (memcmp(digest, session.image_sha256, sizeof(digest)) != 0) {
		(void)cancel_update_locked();
		clear_session_locked();
		err = -EBADMSG;
		goto unlock;
	}

	err = spaghetti_update_finish();
	if (err < 0) {
		goto unlock;
	}
	clear_session_locked();
	err = 0;
	LOG_INF("BLE update finished; trial reboot owned by Update");

unlock:
	k_mutex_unlock(&ota_ble_lock);
	return err;
}

int spaghetti_ota_ble_cancel(uint32_t session_id)
{
	int err;

	if (session_id == 0U) {
		return -EINVAL;
	}

	err = k_mutex_lock(&ota_ble_lock, K_FOREVER);
	if (err < 0) {
		return err;
	}
	if (session.phase == SPAGHETTI_OTA_BLE_IDLE) {
		err = -EALREADY;
		goto unlock;
	}
	if (session.session_id != session_id) {
		err = -ENOENT;
		goto unlock;
	}

	err = cancel_update_locked();
	clear_session_locked();
	if (err == 0) {
		LOG_INF("BLE update cancelled; confirmed image untouched");
	}

unlock:
	k_mutex_unlock(&ota_ble_lock);
	return err;
}
