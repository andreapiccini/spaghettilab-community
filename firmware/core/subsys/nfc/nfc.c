#include <spaghetti/nfc.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/gpio.h>
#include <zephyr/drivers/spi.h>
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/sys/util.h>

LOG_MODULE_REGISTER(spaghetti_nfc, CONFIG_SPAGHETTI_NFC_LOG_LEVEL);

#define NFC_DT_NODE DT_PATH(spaghetti_nfc)
#define NFC_SPI_NODE DT_NODELABEL(spi2)

#define ST25_CMD_SET_DEFAULT 0x60U
#define ST25_CMD_STOP 0x62U
#define ST25_CMD_CLEAR_FIFO 0x64U
#define ST25_CMD_ADJUST_REGULATORS 0x68U
#define ST25_CMD_TRANSMIT 0x6AU
#define ST25_CMD_UNMASK_RX 0x72U
#define ST25_FIFO 0x5FU
#define ST25_READ 0x80U

#define ST25_REG_OPERATION 0x00U
#define ST25_REG_GENERAL 0x01U
#define ST25_REG_TX_DRIVER 0x03U
#define ST25_REG_TX_MOD 0x04U
#define ST25_REG_RX_ANA2 0x07U
#define ST25_REG_RX_DIG 0x08U
#define ST25_REG_CORR1 0x09U
#define ST25_REG_CORR4 0x0CU
#define ST25_REG_CORR5 0x0DU
#define ST25_REG_PROTOCOL 0x12U
#define ST25_REG_PROTOCOL_TX1 0x13U
#define ST25_REG_PROTOCOL_RX1 0x16U
#define ST25_REG_NRT_GPT_CONF 0x1EU
#define ST25_REG_NRT1 0x1FU
#define ST25_REG_NRT2 0x20U
#define ST25_REG_TX_FRAME1 0x34U
#define ST25_REG_TX_FRAME2 0x35U
#define ST25_REG_FIFO_STATUS1 0x36U
#define ST25_REG_IRQ1 0x3CU
#define ST25_REG_IRQ2 0x3DU
#define ST25_REG_IRQ3 0x3EU
#define ST25_REG_IC_ID 0x3FU

#define ST25_OP_TX_EN BIT(5)
#define ST25_OP_RX_EN BIT(4)
#define ST25_OP_AM_EN BIT(3)
#define ST25_OP_EN BIT(1)

#define ST25_GEN_SINGLE BIT(5)
#define ST25_GEN_RFO2 BIT(4)
#define ST25_GEN_MISO_PD (BIT(3) | BIT(2))

#define ST25_TX_MOD_REG_AM BIT(0)
#define ST25_TX_MOD_AM_12PCT (0x4U << 4)

#define ST25_PROT_OM_NFCA 0x01U
#define ST25_TX1_PAR BIT(6)
#define ST25_TX1_CRC BIT(5)
#define ST25_RX1_PAR BIT(3)
#define ST25_RX1_CRC BIT(2)
#define ST25_RX1_ANTCL BIT(0)

#define ST25_IC_TYPE_MASK 0xF8U
#define ST25_IC_TYPE_OK 0xA8U

#define NFCA_WUPA 0x52U
#define NFCA_SEL_CL1 0x93U
#define NFCA_SEL_CL2 0x95U
#define NFCA_SEL_CL3 0x97U
#define NFCA_NVB_FULL 0x20U
#define NFCA_NVB_SELECT 0x70U
#define NFCA_SAK_CASCADE BIT(2)
#define NFCA_SAK_T4T BIT(5)

#define NFC_SCAN_PERIOD_MS 500U
#define NFC_ANTENNAS 2U

#if DT_NODE_EXISTS(NFC_DT_NODE) && DT_NODE_HAS_STATUS(NFC_SPI_NODE, okay)

static const struct device *nfc_spi = DEVICE_DT_GET(NFC_SPI_NODE);
static const struct gpio_dt_spec nfc_rst =
	GPIO_DT_SPEC_GET(NFC_DT_NODE, nfc_reset_gpios);
static const struct gpio_dt_spec nfc_irq =
	GPIO_DT_SPEC_GET(NFC_DT_NODE, nfc_irq_gpios);
static const struct gpio_dt_spec nfc_cs =
	GPIO_DT_SPEC_GET_BY_IDX(NFC_SPI_NODE, cs_gpios, 0);

static struct spi_config nfc_spi_cfg = {
	.frequency = 1000000U,
	.operation = SPI_OP_MODE_MASTER | SPI_WORD_SET(8) | SPI_TRANSFER_MSB |
		     SPI_MODE_CPHA,
	.slave = 0,
};

static bool nfc_ready;
static bool nfc_initialized;
static struct spaghetti_nfc_tag nfc_tags[NFC_ANTENNAS];
static size_t nfc_tag_count;
K_MUTEX_DEFINE(nfc_lock);

static void nfc_scan_work(struct k_work *work);
static K_WORK_DELAYABLE_DEFINE(nfc_scan_dwork, nfc_scan_work);

static int nfc_spi_xfer(const uint8_t *tx, uint8_t *rx, size_t length)
{
	const struct spi_buf tx_buf = {
		.buf = (uint8_t *)tx,
		.len = length,
	};
	const struct spi_buf rx_buf = {
		.buf = rx,
		.len = length,
	};
	const struct spi_buf_set tx_set = {
		.buffers = &tx_buf,
		.count = 1U,
	};
	const struct spi_buf_set rx_set = {
		.buffers = &rx_buf,
		.count = 1U,
	};

	return spi_transceive(nfc_spi, &nfc_spi_cfg, &tx_set,
			      (rx != NULL) ? &rx_set : NULL);
}

static int nfc_write_reg(uint8_t addr, uint8_t value)
{
	uint8_t tx[2] = { addr, value };

	return nfc_spi_xfer(tx, NULL, sizeof(tx));
}

static int nfc_read_reg(uint8_t addr, uint8_t *value)
{
	uint8_t tx[2] = { (uint8_t)(addr | ST25_READ), 0U };
	uint8_t rx[2] = { 0 };
	int err;

	err = nfc_spi_xfer(tx, rx, sizeof(tx));
	if (err < 0) {
		return err;
	}
	*value = rx[1];
	return 0;
}

static int nfc_cmd(uint8_t command)
{
	return nfc_spi_xfer(&command, NULL, 1U);
}

static int nfc_modify(uint8_t addr, uint8_t mask, uint8_t value)
{
	uint8_t current = 0U;
	int err = nfc_read_reg(addr, &current);

	if (err < 0) {
		return err;
	}
	return nfc_write_reg(addr, (uint8_t)((current & (uint8_t)~mask) | (value & mask)));
}

static int nfc_write_fifo(const uint8_t *data, size_t length)
{
	uint8_t tx[1U + 16U];
	size_t i;

	if ((data == NULL) || (length == 0U) || (length > 16U)) {
		return -EINVAL;
	}

	tx[0] = ST25_FIFO;
	for (i = 0U; i < length; ++i) {
		tx[1U + i] = data[i];
	}
	return nfc_spi_xfer(tx, NULL, 1U + length);
}

static int nfc_read_fifo(uint8_t *data, size_t length)
{
	uint8_t tx[1U + 16U];
	uint8_t rx[1U + 16U];
	int err;

	if ((data == NULL) || (length == 0U) || (length > 16U)) {
		return -EINVAL;
	}

	memset(tx, 0, sizeof(tx));
	tx[0] = (uint8_t)(ST25_FIFO | ST25_READ);
	err = nfc_spi_xfer(tx, rx, 1U + length);
	if (err < 0) {
		return err;
	}
	memcpy(data, &rx[1], length);
	return 0;
}

static void nfc_clear_irq(void)
{
	uint8_t discard = 0U;

	(void)nfc_read_reg(ST25_REG_IRQ1, &discard);
	(void)nfc_read_reg(ST25_REG_IRQ2, &discard);
	(void)nfc_read_reg(ST25_REG_IRQ3, &discard);
}

static int nfc_apply_antenna(uint8_t antenna)
{
	const uint8_t rfo2 = (antenna == 1U) ? ST25_GEN_RFO2 : 0U;

	return nfc_modify(ST25_REG_GENERAL,
			  (uint8_t)(ST25_GEN_SINGLE | ST25_GEN_RFO2),
			  (uint8_t)(ST25_GEN_SINGLE | rfo2));
}

static int nfc_field_off(void)
{
	return nfc_modify(ST25_REG_OPERATION,
			  (uint8_t)(ST25_OP_TX_EN | ST25_OP_RX_EN), 0U);
}

static int nfc_field_on(void)
{
	return nfc_modify(ST25_REG_OPERATION,
			  (uint8_t)(ST25_OP_EN | ST25_OP_AM_EN | ST25_OP_TX_EN |
				    ST25_OP_RX_EN),
			  (uint8_t)(ST25_OP_EN | ST25_OP_AM_EN | ST25_OP_TX_EN |
				    ST25_OP_RX_EN));
}

static int nfc_apply_chip_init(void)
{
	int err;

	err = nfc_modify(ST25_REG_GENERAL, ST25_GEN_MISO_PD, ST25_GEN_MISO_PD);
	if (err == 0) {
		err = nfc_modify(ST25_REG_OPERATION, ST25_OP_AM_EN, ST25_OP_AM_EN);
	}
	if (err == 0) {
		err = nfc_modify(ST25_REG_TX_MOD,
				 (uint8_t)(ST25_TX_MOD_REG_AM | 0xF0U),
				 (uint8_t)(ST25_TX_MOD_REG_AM | ST25_TX_MOD_AM_12PCT));
	}
	if (err == 0) {
		err = nfc_modify(ST25_REG_TX_DRIVER, 0x0FU, 0U);
	}
	if (err == 0) {
		err = nfc_modify(ST25_REG_CORR5, BIT(4), BIT(4));
	}
	if (err == 0) {
		err = nfc_modify(ST25_REG_RX_ANA2, 0x0FU, 0x04U);
	}
	return err;
}

static int nfc_apply_nfca(void)
{
	int err;

	err = nfc_write_reg(ST25_REG_PROTOCOL, ST25_PROT_OM_NFCA);
	if (err == 0) {
		err = nfc_modify(ST25_REG_PROTOCOL_TX1, ST25_TX1_CRC, 0U);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_RX_DIG, 0x4CU);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_CORR1, 0xC3U);
	}
	if (err == 0) {
		err = nfc_modify(ST25_REG_CORR5, 0x07U, 0x02U);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_CORR4, 0xAAU);
	}
	return err;
}

static int nfc_set_tx_bits(uint16_t bits)
{
	const uint16_t bytes = bits / 8U;
	const uint8_t extra = (uint8_t)(bits % 8U);
	int err;

	err = nfc_write_reg(ST25_REG_TX_FRAME1, (uint8_t)(bytes >> 5));
	if (err < 0) {
		return err;
	}
	return nfc_write_reg(ST25_REG_TX_FRAME2,
			     (uint8_t)(((bytes & 0x1FU) << 3) | (extra & 0x07U)));
}

static int nfc_set_nrt_ms(uint8_t ms)
{
	int err;

	err = nfc_modify(ST25_REG_NRT_GPT_CONF, BIT(0), BIT(0));
	if (err < 0) {
		return err;
	}
	err = nfc_write_reg(ST25_REG_NRT1, 0U);
	if (err < 0) {
		return err;
	}
	return nfc_write_reg(ST25_REG_NRT2, (uint8_t)MAX(1U, (uint32_t)ms * 3U));
}

static int nfc_transceive(const uint8_t *tx, size_t tx_len, uint16_t tx_bits,
			  uint8_t *rx, size_t rx_max, size_t *rx_len,
			  bool anticoll, bool crc)
{
	uint8_t fifo = 0U;
	uint32_t waited = 0U;
	int err;

	*rx_len = 0U;
	err = nfc_cmd(ST25_CMD_STOP);
	if (err == 0) {
		err = nfc_cmd(ST25_CMD_CLEAR_FIFO);
	}
	if (err < 0) {
		return err;
	}
	nfc_clear_irq();

	err = nfc_modify(ST25_REG_PROTOCOL_TX1,
			 (uint8_t)(ST25_TX1_PAR | ST25_TX1_CRC),
			 crc ? (uint8_t)(ST25_TX1_PAR | ST25_TX1_CRC) : 0U);
	if (err == 0) {
		err = nfc_modify(ST25_REG_PROTOCOL_RX1,
				 (uint8_t)(ST25_RX1_PAR | ST25_RX1_CRC |
					   ST25_RX1_ANTCL),
				 (uint8_t)((crc ? (ST25_RX1_PAR | ST25_RX1_CRC) : 0U) |
					   (anticoll ? ST25_RX1_ANTCL : 0U)));
	}
	if (err == 0) {
		err = nfc_set_tx_bits(tx_bits);
	}
	if (err == 0) {
		err = nfc_set_nrt_ms(8U);
	}
	if ((err == 0) && (tx_len > 0U)) {
		err = nfc_write_fifo(tx, tx_len);
	}
	if (err == 0) {
		err = nfc_cmd(ST25_CMD_UNMASK_RX);
	}
	if (err == 0) {
		err = nfc_cmd(ST25_CMD_TRANSMIT);
	}
	if (err < 0) {
		return err;
	}

	while (waited < 80U) {
		k_sleep(K_MSEC(1));
		waited += 1U;
		err = nfc_read_reg(ST25_REG_FIFO_STATUS1, &fifo);
		if (err < 0) {
			return err;
		}
		if (fifo > 0U) {
			const size_t copy = MIN((size_t)fifo, rx_max);

			err = nfc_read_fifo(rx, copy);
			if (err < 0) {
				return err;
			}
			*rx_len = copy;
			nfc_clear_irq();
			return 0;
		}
	}

	nfc_clear_irq();
	return -ETIMEDOUT;
}

static uint8_t nfc_bcc(const uint8_t *uid, size_t length)
{
	uint8_t bcc = 0U;
	size_t i;

	for (i = 0U; i < length; ++i) {
		bcc ^= uid[i];
	}
	return bcc;
}

static int nfc_anticollision(uint8_t sel, uint8_t *uid4, uint8_t *sak)
{
	uint8_t tx[7];
	uint8_t rx[8];
	size_t rx_len = 0U;
	int err;

	tx[0] = sel;
	tx[1] = NFCA_NVB_FULL;
	err = nfc_transceive(tx, 2U, 16U, rx, sizeof(rx), &rx_len, true, false);
	if ((err < 0) || (rx_len < 5U)) {
		return (err < 0) ? err : -ENOENT;
	}
	if (nfc_bcc(rx, 4U) != rx[4]) {
		return -EBADMSG;
	}
	memcpy(uid4, rx, 4U);

	tx[0] = sel;
	tx[1] = NFCA_NVB_SELECT;
	memcpy(&tx[2], uid4, 4U);
	tx[6] = nfc_bcc(uid4, 4U);
	err = nfc_transceive(tx, 7U, 56U, rx, sizeof(rx), &rx_len, false, true);
	if ((err < 0) || (rx_len < 1U)) {
		return (err < 0) ? err : -ENOENT;
	}
	*sak = rx[0];
	return 0;
}

static int nfc_scan_antenna(uint8_t antenna, struct spaghetti_nfc_tag *tag)
{
	uint8_t wupa = NFCA_WUPA;
	uint8_t atqa[2] = { 0 };
	uint8_t uid[SPAGHETTI_NFC_UID_SIZE];
	uint8_t uid4[4];
	uint8_t sak = 0U;
	uint8_t uid_len = 0U;
	size_t rx_len = 0U;
	int err;

	memset(tag, 0, sizeof(*tag));
	err = nfc_field_off();
	if (err == 0) {
		err = nfc_apply_nfca();
	}
	if (err == 0) {
		err = nfc_apply_antenna(antenna);
	}
	if (err == 0) {
		err = nfc_field_on();
	}
	if (err == 0) {
		err = nfc_apply_antenna(antenna);
	}
	if (err < 0) {
		(void)nfc_field_off();
		return err;
	}
	k_sleep(K_MSEC(40));

	err = nfc_transceive(&wupa, 1U, 7U, atqa, sizeof(atqa), &rx_len, true,
			     false);
	if ((err < 0) || (rx_len < 2U)) {
		(void)nfc_field_off();
		return -ENOENT;
	}

	err = nfc_anticollision(NFCA_SEL_CL1, uid4, &sak);
	if (err < 0) {
		(void)nfc_field_off();
		return err;
	}
	if ((uid4[0] == 0x88U) || ((sak & NFCA_SAK_CASCADE) != 0U)) {
		memcpy(uid, &uid4[1], 3U);
		uid_len = 3U;
		err = nfc_anticollision(NFCA_SEL_CL2, uid4, &sak);
		if (err < 0) {
			(void)nfc_field_off();
			return err;
		}
		if ((uid4[0] == 0x88U) || ((sak & NFCA_SAK_CASCADE) != 0U)) {
			memcpy(&uid[uid_len], &uid4[1], 3U);
			uid_len = 6U;
			err = nfc_anticollision(NFCA_SEL_CL3, uid4, &sak);
			if (err < 0) {
				(void)nfc_field_off();
				return err;
			}
			memcpy(&uid[uid_len], uid4, 4U);
			uid_len = 10U;
		} else {
			memcpy(&uid[uid_len], uid4, 4U);
			uid_len = 7U;
		}
	} else {
		memcpy(uid, uid4, 4U);
		uid_len = 4U;
	}

	(void)nfc_field_off();
	tag->antenna = antenna;
	tag->uid_len = uid_len;
	memcpy(tag->uid, uid, uid_len);
	tag->local = true;
	if ((sak & NFCA_SAK_T4T) != 0U) {
		tag->type = SPAGHETTI_NFC_TYPE_T4T;
	} else {
		tag->type = SPAGHETTI_NFC_TYPE_T2T;
	}
	return 0;
}

static void nfc_scan_work(struct k_work *work)
{
	struct spaghetti_nfc_tag found[NFC_ANTENNAS];
	size_t count = 0U;
	uint8_t antenna;

	ARG_UNUSED(work);
	if (!nfc_ready) {
		(void)k_work_schedule(&nfc_scan_dwork, K_MSEC(NFC_SCAN_PERIOD_MS));
		return;
	}

	for (antenna = 1U; antenna <= NFC_ANTENNAS; ++antenna) {
		struct spaghetti_nfc_tag tag;
		int err = nfc_scan_antenna(antenna, &tag);

		if (err == 0) {
			found[count] = tag;
			count += 1U;
		}
	}

	(void)k_mutex_lock(&nfc_lock, K_FOREVER);
	nfc_tag_count = count;
	if (count > 0U) {
		memcpy(nfc_tags, found, count * sizeof(found[0]));
	}
	k_mutex_unlock(&nfc_lock);
	(void)k_work_schedule(&nfc_scan_dwork, K_MSEC(NFC_SCAN_PERIOD_MS));
}

static int nfc_probe_chip(void)
{
	uint8_t ic_id = 0U;
	int err;

	if (!device_is_ready(nfc_spi) || !gpio_is_ready_dt(&nfc_rst) ||
	    !gpio_is_ready_dt(&nfc_cs)) {
		return -ENODEV;
	}

	nfc_spi_cfg.cs.gpio = nfc_cs;
	nfc_spi_cfg.cs.delay = 0U;

	(void)gpio_pin_configure(nfc_rst.port, nfc_rst.pin, GPIO_OUTPUT);
	if (gpio_is_ready_dt(&nfc_irq)) {
		(void)gpio_pin_configure_dt(&nfc_irq, GPIO_INPUT);
	}
	(void)gpio_pin_configure_dt(&nfc_cs, GPIO_OUTPUT_INACTIVE);

	gpio_pin_set_raw(nfc_rst.port, nfc_rst.pin, 1);
	k_sleep(K_MSEC(2));
	gpio_pin_set_raw(nfc_rst.port, nfc_rst.pin, 0);
	k_sleep(K_MSEC(5));

	err = nfc_read_reg(ST25_REG_IC_ID, &ic_id);
	if ((err < 0) || ((ic_id & ST25_IC_TYPE_MASK) != ST25_IC_TYPE_OK)) {
		LOG_WRN("ST25R100 missing ic_id=0x%02x err=%d", ic_id, err);
		gpio_pin_set_raw(nfc_rst.port, nfc_rst.pin, 1);
		return -ENODEV;
	}

	err = nfc_cmd(ST25_CMD_SET_DEFAULT);
	if (err == 0) {
		k_sleep(K_MSEC(2));
		err = nfc_apply_chip_init();
	}
	if (err == 0) {
		err = nfc_modify(ST25_REG_OPERATION, ST25_OP_EN, ST25_OP_EN);
	}
	if (err == 0) {
		k_sleep(K_MSEC(10));
		err = nfc_cmd(ST25_CMD_ADJUST_REGULATORS);
	}
	if (err < 0) {
		return err;
	}
	k_sleep(K_MSEC(5));
	nfc_clear_irq();
	LOG_INF("ST25R100 ready ic_id=0x%02x", ic_id);
	return 0;
}

int spaghetti_nfc_init(void)
{
	int err;

	if (nfc_initialized) {
		return -EALREADY;
	}

	nfc_initialized = true;
	err = nfc_probe_chip();
	if (err < 0) {
		nfc_ready = false;
		return 0;
	}

	nfc_ready = true;
	(void)k_work_schedule(&nfc_scan_dwork, K_MSEC(200));
	return 0;
}

int spaghetti_nfc_copy_tags(struct spaghetti_nfc_tag *out, size_t max,
			    size_t *count)
{
	if (count == NULL) {
		return -EINVAL;
	}
	if ((out == NULL) && (max != 0U)) {
		return -EINVAL;
	}

	(void)k_mutex_lock(&nfc_lock, K_FOREVER);
	if (out == NULL) {
		*count = nfc_tag_count;
	} else {
		*count = MIN(nfc_tag_count, max);
		if (*count > 0U) {
			memcpy(out, nfc_tags, (*count) * sizeof(*out));
		}
	}
	k_mutex_unlock(&nfc_lock);
	return 0;
}

#else /* !NFC DT */

int spaghetti_nfc_init(void)
{
	return 0;
}

int spaghetti_nfc_copy_tags(struct spaghetti_nfc_tag *out, size_t max,
			    size_t *count)
{
	if (count == NULL) {
		return -EINVAL;
	}
	if ((out == NULL) && (max != 0U)) {
		return -EINVAL;
	}

	*count = 0U;
	return 0;
}

#endif

const char *spaghetti_nfc_type_id(uint8_t type)
{
	if (type == SPAGHETTI_NFC_TYPE_T2T) {
		return "t2t";
	}
	if (type == SPAGHETTI_NFC_TYPE_T4T) {
		return "t4t";
	}

	return "tag";
}
