#include <spaghetti/nfc.h>

#include <errno.h>
#include <stdbool.h>
#include <string.h>

#include <spaghetti/communication.h>
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
#include <spaghetti/field_update.h>
#endif

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
#define ST25_CMD_CLEAR_RX_GAIN 0x66U
#define ST25_CMD_ADJUST_REGULATORS 0x68U
#define ST25_CMD_TRANSMIT 0x6AU
#define ST25_CMD_UNMASK_RX 0x72U
#define ST25_CMD_CALIBRATE_WU 0x74U
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
#define ST25_REG_WAKEUP_CONF1 0x28U
#define ST25_REG_WAKEUP_CONF2 0x29U
#define ST25_REG_WU_I_CONF 0x2AU
#define ST25_REG_WU_I_DELTA 0x2BU
#define ST25_REG_WU_Q_CONF 0x2FU
#define ST25_REG_WU_Q_DELTA 0x30U
#define ST25_REG_TX_FRAME1 0x34U
#define ST25_REG_TX_FRAME2 0x35U
#define ST25_REG_FIFO_STATUS1 0x36U
#define ST25_REG_IRQ_MASK1 0x39U
#define ST25_REG_IRQ_MASK2 0x3AU
#define ST25_REG_IRQ_MASK3 0x3BU
#define ST25_REG_IRQ1 0x3CU
#define ST25_REG_IRQ2 0x3DU
#define ST25_REG_IRQ3 0x3EU
#define ST25_REG_IC_ID 0x3FU

#define ST25_OP_TX_EN BIT(5)
#define ST25_OP_RX_EN BIT(4)
#define ST25_OP_AM_EN BIT(3)
#define ST25_OP_EN BIT(1)
#define ST25_OP_WU_EN BIT(0)

#define ST25_WUT_SHIFT 4U
#define ST25_WUT_PERIOD_215MS 0x09U
#define ST25_WUTI BIT(3)
#define ST25_WU_AUTO_AVG BIT(3)
#define ST25_WU_MEAS_DUR_44_28 0x03U
#define ST25_WU_AA_INCL BIT(6)
#define ST25_WU_AA_WEIGHT_32 (0x03U << 4)
#define ST25_WU_TRE_ABOVE BIT(2)
#define ST25_WU_TRE_BELOW BIT(0)
#define ST25_WU_DELTA 4U
#define ST25_IRQ3_WUT BIT(1)
#define ST25_IRQ3_WUI BIT(2)
#define ST25_IRQ3_WUQ BIT(3)
#define ST25_IRQ_MASK3_WU \
	(uint8_t)~(ST25_IRQ3_WUT | ST25_IRQ3_WUI | ST25_IRQ3_WUQ)

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
#define NFCA_T2T_READ 0x30U

#define NFC_FALLBACK_PERIOD_MS 500U
#define NFC_ANTENNAS 2U
#define SLM_USER_BYTES 160U
#define SLM_USER_FIRST_PAGE 4U
#define SLM_READ_CHUNK 16U
#define SLM_SCHEMA_MAJOR 1U

/* Fixed NDEF envelope for Spaghetti LAB module records (blocks 4..10). */
static const uint8_t slm_ndef_envelope[28] = {
	0x03, 0x9a, 0xd4, 0x17, 0x80, 0x73, 0x70, 0x61, 0x67, 0x68, 0x65, 0x74,
	0x74, 0x69, 0x6c, 0x61, 0x62, 0x2e, 0x63, 0x6f, 0x6d, 0x3a, 0x6d, 0x6f,
	0x64, 0x75, 0x6c, 0x65,
};
static const uint8_t slm_magic[4] = { 0x53, 0x4c, 0x4d, 0x31 }; /* SLM1 */

#if DT_NODE_EXISTS(NFC_DT_NODE) && DT_NODE_HAS_STATUS(NFC_SPI_NODE, okay)

static const struct device *nfc_spi = DEVICE_DT_GET(NFC_SPI_NODE);
static const struct gpio_dt_spec nfc_rst =
	GPIO_DT_SPEC_GET(NFC_DT_NODE, nfc_reset_gpios);
#if DT_NODE_HAS_PROP(NFC_DT_NODE, nfc_irq_gpios)
static const struct gpio_dt_spec nfc_irq =
	GPIO_DT_SPEC_GET(NFC_DT_NODE, nfc_irq_gpios);
#define SPAGHETTI_NFC_HAS_IRQ_GPIO 1
#else
#define SPAGHETTI_NFC_HAS_IRQ_GPIO 0
#endif
static const struct gpio_dt_spec nfc_cs =
	GPIO_DT_SPEC_GET_BY_IDX(NFC_SPI_NODE, cs_gpios, 0);
static const struct gpio_dt_spec nfc_sck =
	GPIO_DT_SPEC_GET(NFC_DT_NODE, nfc_sck_gpios);
static const struct gpio_dt_spec nfc_mosi =
	GPIO_DT_SPEC_GET(NFC_DT_NODE, nfc_mosi_gpios);
static const struct gpio_dt_spec nfc_miso =
	GPIO_DT_SPEC_GET(NFC_DT_NODE, nfc_miso_gpios);

static struct spi_config nfc_spi_cfg = {
	.frequency = 1000000U,
	.operation = SPI_OP_MODE_MASTER | SPI_WORD_SET(8) | SPI_TRANSFER_MSB |
		     SPI_MODE_CPHA,
	.slave = 0,
};

static bool nfc_ready;
static bool nfc_initialized;
static bool nfc_irq_armed;
static bool nfc_wum_on;
static bool nfc_tag_present;
static bool nfc_software_spi;
static uint8_t nfc_wum_antenna = 1U;
static uint32_t nfc_generation = 1U;
static struct spaghetti_nfc_tag nfc_tags[NFC_ANTENNAS];
static size_t nfc_tag_count;
K_MUTEX_DEFINE(nfc_lock);

#if SPAGHETTI_NFC_HAS_IRQ_GPIO
static struct gpio_callback nfc_irq_cb;
#endif
static void nfc_irq_work_fn(struct k_work *work);
static void nfc_fallback_work(struct k_work *work);
static K_WORK_DEFINE(nfc_irq_work, nfc_irq_work_fn);
static K_WORK_DELAYABLE_DEFINE(nfc_fallback_dwork, nfc_fallback_work);

static int nfc_software_spi_xfer(const uint8_t *tx, uint8_t *rx, size_t length)
{
	size_t byte;

	gpio_pin_set_raw(nfc_cs.port, nfc_cs.pin, 0);
	for (byte = 0U; byte < length; ++byte) {
		uint8_t input = 0U;
		uint8_t mask;

		for (mask = BIT(7); mask != 0U; mask >>= 1U) {
			/* ST25R100 SPI mode 1: change on rising, sample on falling. */
			gpio_pin_set_raw(nfc_sck.port, nfc_sck.pin, 1);
			gpio_pin_set_raw(nfc_mosi.port, nfc_mosi.pin,
					 (tx[byte] & mask) != 0U);
			k_busy_wait(2U);
			gpio_pin_set_raw(nfc_sck.port, nfc_sck.pin, 0);
			k_busy_wait(2U);
			if (gpio_pin_get_raw(nfc_miso.port, nfc_miso.pin) > 0) {
				input |= mask;
			}
		}
		if (rx != NULL) {
			rx[byte] = input;
		}
	}
	gpio_pin_set_raw(nfc_cs.port, nfc_cs.pin, 1);
	return 0;
}

static int nfc_spi_xfer(const uint8_t *tx, uint8_t *rx, size_t length)
{
	int err;
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

	if (nfc_software_spi) {
		return nfc_software_spi_xfer(tx, rx, length);
	}

	/*
	 * Keep CS under our control so the ST25R100 sees one uninterrupted low
	 * pulse for the complete command and response transaction.
	 */
	gpio_pin_set_raw(nfc_cs.port, nfc_cs.pin, 0);
	err = spi_transceive(nfc_spi, &nfc_spi_cfg, &tx_set,
			     (rx != NULL) ? &rx_set : NULL);
	gpio_pin_set_raw(nfc_cs.port, nfc_cs.pin, 1);

	return err;
}

static int nfc_enable_software_spi(void)
{
	if (!gpio_is_ready_dt(&nfc_sck) || !gpio_is_ready_dt(&nfc_mosi) ||
	    !gpio_is_ready_dt(&nfc_miso)) {
		return -ENODEV;
	}

	if ((gpio_pin_configure_dt(&nfc_sck, GPIO_OUTPUT_INACTIVE) < 0) ||
	    (gpio_pin_configure_dt(&nfc_mosi, GPIO_OUTPUT_INACTIVE) < 0) ||
	    (gpio_pin_configure_dt(&nfc_miso, GPIO_INPUT) < 0)) {
		return -EIO;
	}
	nfc_software_spi = true;
	return 0;
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
		err = nfc_cmd(ST25_CMD_CLEAR_RX_GAIN);
	}
	if (err == 0) {
		err = nfc_cmd(ST25_CMD_CLEAR_FIFO);
	}
	if (err < 0) {
		return err;
	}
	nfc_clear_irq();

	err = nfc_modify(ST25_REG_PROTOCOL_TX1,
			 (uint8_t)(ST25_TX1_PAR | ST25_TX1_CRC),
			 (uint8_t)(ST25_TX1_PAR |
				   (crc ? ST25_TX1_CRC : 0U)));
	if (err == 0) {
		err = nfc_modify(ST25_REG_PROTOCOL_RX1,
				 (uint8_t)(ST25_RX1_PAR | ST25_RX1_CRC |
					   ST25_RX1_ANTCL),
				 (uint8_t)(ST25_RX1_PAR |
					   (crc ? ST25_RX1_CRC : 0U) |
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

static uint16_t slm_be16(const uint8_t *p)
{
	return (uint16_t)(((uint16_t)p[0] << 8) | p[1]);
}

static uint32_t slm_be32(const uint8_t *p)
{
	return ((uint32_t)p[0] << 24) | ((uint32_t)p[1] << 16) |
	       ((uint32_t)p[2] << 8) | (uint32_t)p[3];
}

static int nfc_t2t_read_chunk(uint8_t page, uint8_t out[SLM_READ_CHUNK])
{
	uint8_t tx[2] = { NFCA_T2T_READ, page };
	uint8_t rx[18];
	size_t rx_len = 0U;
	int err;

	err = nfc_transceive(tx, 2U, 16U, rx, sizeof(rx), &rx_len, false, true);
	if ((err < 0) || (rx_len < SLM_READ_CHUNK)) {
		return (err < 0) ? err : -EBADMSG;
	}
	memcpy(out, rx, SLM_READ_CHUNK);
	return 0;
}

/**
 * Read ST25TN01K user memory and accept only SLM1 NDEF module records.
 * Field must stay on after SELECT. Rejects blank / third-party tags.
 */
static int nfc_read_slm1(struct spaghetti_nfc_tag *tag)
{
	uint8_t mem[SLM_USER_BYTES];
	uint8_t chunk;
	uint16_t registry_id;
	uint16_t vendor_id;
	uint32_t module_type_id;
	uint16_t fallback_class;

	for (chunk = 0U; chunk < (SLM_USER_BYTES / SLM_READ_CHUNK); ++chunk) {
		const uint8_t page =
			(uint8_t)(SLM_USER_FIRST_PAGE + (chunk * 4U));

		if (nfc_t2t_read_chunk(page, &mem[chunk * SLM_READ_CHUNK]) <
		    0) {
			return -EIO;
		}
	}

	if (memcmp(mem, slm_ndef_envelope, sizeof(slm_ndef_envelope)) != 0) {
		return -ENOENT;
	}
	if (mem[156] != 0xFEU) {
		return -ENOENT;
	}
	if (memcmp(&mem[28], slm_magic, sizeof(slm_magic)) != 0) {
		return -ENOENT;
	}
	if (mem[32] != SLM_SCHEMA_MAJOR) {
		return -ENOENT;
	}
	if ((mem[34] & 0xF0U) != 0U) {
		return -ENOENT;
	}
	if (mem[35] != 128U) {
		return -ENOENT;
	}

	registry_id = slm_be16(&mem[36]);
	vendor_id = slm_be16(&mem[38]);
	module_type_id = slm_be32(&mem[40]);
	fallback_class = slm_be16(&mem[112]);
	if ((registry_id == 0U) || (vendor_id == 0U) ||
	    (module_type_id == 0U)) {
		return -ENOENT;
	}

	tag->registry_id = registry_id;
	tag->vendor_id = vendor_id;
	tag->module_type_id = module_type_id;
	tag->fallback_class = fallback_class;
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

	tag->antenna = antenna;
	tag->uid_len = uid_len;
	memcpy(tag->uid, uid, uid_len);
	tag->local = true;
	if ((sak & NFCA_SAK_T4T) != 0U) {
		/* SLM1 lives on ST25TN01K Type 2 tags only. */
		(void)nfc_field_off();
		return -ENOENT;
	}
	tag->type = SPAGHETTI_NFC_TYPE_T2T;
	err = nfc_read_slm1(tag);
	(void)nfc_field_off();
	if (err < 0) {
		memset(tag, 0, sizeof(*tag));
		return -ENOENT;
	}
	return 0;
}

static bool nfc_tags_same(const struct spaghetti_nfc_tag *left, size_t left_n,
			  const struct spaghetti_nfc_tag *right, size_t right_n)
{
	size_t i;

	if (left_n != right_n) {
		return false;
	}
	for (i = 0U; i < left_n; ++i) {
		if ((left[i].antenna != right[i].antenna) ||
		    (left[i].type != right[i].type) ||
		    (left[i].uid_len != right[i].uid_len) ||
		    (left[i].module_type_id != right[i].module_type_id) ||
		    (left[i].fallback_class != right[i].fallback_class) ||
		    (memcmp(left[i].uid, right[i].uid, left[i].uid_len) !=
		     0)) {
			return false;
		}
	}
	return true;
}

static void nfc_notify_host(uint8_t port_id)
{
	uint32_t candidate_id = 0U;
	uint32_t generation;

	(void)k_mutex_lock(&nfc_lock, K_FOREVER);
	generation = nfc_generation;
	nfc_generation += 1U;
	if (nfc_generation == 0U) {
		nfc_generation = 1U;
	}
	if (nfc_tag_count > 0U) {
		size_t i;

		for (i = 0U; i < nfc_tags[0].uid_len; ++i) {
			candidate_id = (candidate_id << 8) | nfc_tags[0].uid[i];
		}
	}
	k_mutex_unlock(&nfc_lock);
	if (candidate_id == 0U) {
		candidate_id = generation;
	}

	(void)spaghetti_communication_emit_discovery(candidate_id, port_id,
						     generation);
}

static void nfc_irq_disable(void)
{
#if SPAGHETTI_NFC_HAS_IRQ_GPIO
	if (nfc_irq_armed && gpio_is_ready_dt(&nfc_irq)) {
		(void)gpio_pin_interrupt_configure_dt(&nfc_irq,
						      GPIO_INT_DISABLE);
	}
#endif
}

static void nfc_irq_enable(void)
{
#if SPAGHETTI_NFC_HAS_IRQ_GPIO
	if (nfc_irq_armed && gpio_is_ready_dt(&nfc_irq)) {
		(void)gpio_pin_interrupt_configure_dt(&nfc_irq,
						      GPIO_INT_EDGE_TO_ACTIVE);
	}
#endif
}

static void nfc_wum_stop(void)
{
	if (!nfc_wum_on) {
		return;
	}

	(void)nfc_modify(ST25_REG_OPERATION, ST25_OP_WU_EN, 0U);
	(void)nfc_modify(ST25_REG_OPERATION, ST25_OP_EN, ST25_OP_EN);
	(void)nfc_cmd(ST25_CMD_STOP);
	nfc_clear_irq();
	nfc_wum_on = false;
	k_sleep(K_MSEC(2));
}

static int nfc_wum_start(uint8_t antenna)
{
	const uint8_t ch_conf =
		(uint8_t)(ST25_WU_AA_INCL | ST25_WU_AA_WEIGHT_32 |
			  ST25_WU_TRE_ABOVE | ST25_WU_TRE_BELOW);
	int err;

	nfc_wum_stop();
	(void)nfc_field_off();
	err = nfc_apply_antenna(antenna);
	if (err < 0) {
		return err;
	}

	err = nfc_write_reg(ST25_REG_WAKEUP_CONF1,
			    (uint8_t)((ST25_WUT_PERIOD_215MS << ST25_WUT_SHIFT) |
				      ST25_WUTI));
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_WAKEUP_CONF2,
				    (uint8_t)(ST25_WU_AUTO_AVG |
					      ST25_WU_MEAS_DUR_44_28));
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_WU_I_DELTA, ST25_WU_DELTA);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_WU_I_CONF, ch_conf);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_WU_Q_DELTA, ST25_WU_DELTA);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_WU_Q_CONF, ch_conf);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_IRQ_MASK1, 0xFFU);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_IRQ_MASK2, 0xFFU);
	}
	if (err == 0) {
		err = nfc_write_reg(ST25_REG_IRQ_MASK3, ST25_IRQ_MASK3_WU);
	}
	if (err == 0) {
		err = nfc_cmd(ST25_CMD_CALIBRATE_WU);
	}
	if (err < 0) {
		return err;
	}

	k_sleep(K_MSEC(2));
	nfc_clear_irq();
	err = nfc_modify(ST25_REG_OPERATION,
			 (uint8_t)(ST25_OP_TX_EN | ST25_OP_RX_EN |
				   ST25_OP_AM_EN | ST25_OP_EN | ST25_OP_WU_EN),
			 ST25_OP_WU_EN);
	if (err < 0) {
		return err;
	}

	nfc_wum_antenna = antenna;
	nfc_wum_on = true;
	return 0;
}

static void nfc_store_scan(const struct spaghetti_nfc_tag *found, size_t count)
{
	bool changed;

	(void)k_mutex_lock(&nfc_lock, K_FOREVER);
	changed = !nfc_tags_same(nfc_tags, nfc_tag_count, found, count);
	nfc_tag_count = count;
	nfc_tag_present = count > 0U;
	if (count > 0U) {
		memcpy(nfc_tags, found, count * sizeof(found[0]));
	}
	k_mutex_unlock(&nfc_lock);
	if (changed) {
		if (count > 0U) {
#if defined(CONFIG_SPAGHETTI_FIELD_UPDATE)
			spaghetti_field_update_nfc_feedback();
#endif
			LOG_INF("NFC tag read on antenna %u", found[0].antenna);
		}
		nfc_notify_host((count > 0U) ? found[0].antenna : 0U);
	}
}

static uint8_t nfc_scan_both(void)
{
	struct spaghetti_nfc_tag found[NFC_ANTENNAS];
	size_t count = 0U;
	uint8_t antenna;

	for (antenna = 1U; antenna <= NFC_ANTENNAS; ++antenna) {
		struct spaghetti_nfc_tag tag;

		if (nfc_scan_antenna(antenna, &tag) == 0) {
			found[count] = tag;
			count += 1U;
		}
	}
	nfc_store_scan(found, count);
	return (count > 0U) ? found[0].antenna : 0U;
}

static void nfc_handle_wakeup(bool load_changed)
{
	const uint8_t monitored = nfc_wum_antenna;
	uint8_t next = (monitored == 1U) ? 2U : 1U;

	nfc_irq_disable();
	nfc_wum_stop();
	if (load_changed) {
		const uint8_t found = nfc_scan_both();

		if (found != 0U) {
			next = found;
		}
	} else if (nfc_tag_present) {
		next = monitored;
	}

	if (nfc_wum_start(next) < 0) {
		LOG_WRN("wake-up restart failed, falling back to poll");
		(void)k_work_schedule(&nfc_fallback_dwork,
				      K_MSEC(NFC_FALLBACK_PERIOD_MS));
	} else {
		nfc_irq_enable();
	}
}

static void nfc_irq_work_fn(struct k_work *work)
{
	uint8_t irq3 = 0U;
	bool load_changed;
	bool timed_out;

	ARG_UNUSED(work);
	if (!nfc_ready) {
		return;
	}

	(void)nfc_read_reg(ST25_REG_IRQ3, &irq3);
	nfc_clear_irq();
	load_changed = (irq3 & (ST25_IRQ3_WUI | ST25_IRQ3_WUQ)) != 0U;
	timed_out = (irq3 & ST25_IRQ3_WUT) != 0U;
	if (!load_changed && !timed_out) {
		if (nfc_wum_on) {
			return;
		}
		load_changed = true;
	}
	nfc_handle_wakeup(load_changed);
}

#if SPAGHETTI_NFC_HAS_IRQ_GPIO
static void nfc_irq_isr(const struct device *port, struct gpio_callback *cb,
			uint32_t pins)
{
	ARG_UNUSED(port);
	ARG_UNUSED(cb);
	ARG_UNUSED(pins);
	(void)k_work_submit(&nfc_irq_work);
}
#endif

static void nfc_fallback_work(struct k_work *work)
{
	ARG_UNUSED(work);
	if (!nfc_ready) {
		return;
	}

	nfc_handle_wakeup(true);
	(void)k_work_schedule(&nfc_fallback_dwork,
			      K_MSEC(NFC_FALLBACK_PERIOD_MS));
}

static int nfc_probe_chip(void)
{
	uint8_t ic_id = 0U;
	int err;

	if (!device_is_ready(nfc_spi) || !gpio_is_ready_dt(&nfc_rst) ||
	    !gpio_is_ready_dt(&nfc_cs)) {
		return -ENODEV;
	}

	(void)gpio_pin_configure(nfc_rst.port, nfc_rst.pin, GPIO_OUTPUT);
#if SPAGHETTI_NFC_HAS_IRQ_GPIO
	if (gpio_is_ready_dt(&nfc_irq)) {
		(void)gpio_pin_configure_dt(&nfc_irq, GPIO_INPUT);
		gpio_init_callback(&nfc_irq_cb, nfc_irq_isr, BIT(nfc_irq.pin));
		if (gpio_add_callback(nfc_irq.port, &nfc_irq_cb) == 0) {
			nfc_irq_armed =
				gpio_pin_interrupt_configure_dt(
					&nfc_irq, GPIO_INT_EDGE_TO_ACTIVE) == 0;
		}
	}
#endif
	(void)gpio_pin_configure_dt(&nfc_cs, GPIO_OUTPUT_INACTIVE);

	gpio_pin_set_raw(nfc_rst.port, nfc_rst.pin, 1);
	k_sleep(K_MSEC(2));
	gpio_pin_set_raw(nfc_rst.port, nfc_rst.pin, 0);
	k_sleep(K_MSEC(5));

	err = nfc_read_reg(ST25_REG_IC_ID, &ic_id);
	if ((err < 0) || ((ic_id & ST25_IC_TYPE_MASK) != ST25_IC_TYPE_OK)) {
		LOG_WRN("hardware SPI probe returned ic_id=0x%02x err=%d; trying software SPI",
			ic_id, err);
		if (nfc_enable_software_spi() == 0) {
			ic_id = 0U;
			err = nfc_read_reg(ST25_REG_IC_ID, &ic_id);
		}
	}
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
	LOG_INF("ST25R100 ready ic_id=0x%02x spi=%s", ic_id,
		nfc_software_spi ? "software" : "hardware");
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
	if (nfc_wum_start(1U) < 0) {
		LOG_WRN("wake-up mode failed, polling Type-A");
		nfc_irq_armed = false;
	} else if (!nfc_irq_armed) {
		LOG_WRN("NFC IRQ GPIO missing, polling Type-A");
	} else {
#if SPAGHETTI_NFC_HAS_IRQ_GPIO
		LOG_INF("NFC IRQ GPIO%u plus Type-A poll", nfc_irq.pin);
#else
		LOG_INF("NFC waiting on IRQ plus Type-A poll");
#endif
	}
	(void)k_work_schedule(&nfc_fallback_dwork, K_MSEC(200));
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

const char *spaghetti_nfc_type_id(const struct spaghetti_nfc_tag *tag)
{
	if (tag == NULL) {
		return "tag";
	}
	if (tag->module_type_id != 0U) {
		switch (tag->fallback_class) {
		case 0x0001U:
			return "backbone";
		case 0x0002U:
			return "power";
		case 0x0003U:
			return "sensor";
		case 0x0004U:
			return "actuator";
		case 0x0005U:
			return "iface";
		case 0x0006U:
			return "ctrl";
		case 0x0007U:
			return "adapter";
		default:
			return "module";
		}
	}
	if (tag->type == SPAGHETTI_NFC_TYPE_T2T) {
		return "t2t";
	}
	if (tag->type == SPAGHETTI_NFC_TYPE_T4T) {
		return "t4t";
	}

	return "tag";
}
