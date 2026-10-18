/* Mutable NFC presence fixture for the real GET_STATUS operation encoder. */
#include <spaghetti/nfc.h>
#include <errno.h>
#include <string.h>

bool test_nfc_present;

int spaghetti_nfc_copy_tags(struct spaghetti_nfc_tag *out, size_t max, size_t *count)
{
	if (count == NULL || (out == NULL && max != 0U)) return -EINVAL;
	*count = test_nfc_present ? 1U : 0U;
	if (out != NULL && max > 0U && test_nfc_present) {
		const struct spaghetti_nfc_tag blank = {
			.antenna = 1U,
			.type = SPAGHETTI_NFC_TYPE_T2T,
			.uid_len = 7U,
			.uid = {2U, 1U, 2U, 3U, 4U, 5U, 6U},
			.node_id = 0xe18030U,
			.local = false,
			.module_type_id = 0U,
		};

		*out = blank;
	}
	return 0;
}

const char *spaghetti_nfc_type_id(const struct spaghetti_nfc_tag *tag)
{
	(void)tag;
	return "t2t";
}

int spaghetti_nfc_init(void) { return 0; }
int spaghetti_nfc_user_page(uint8_t antenna, const uint8_t uid[7], uint8_t page,
                           uint8_t data[4], bool write)
{
 (void)antenna; (void)uid; (void)page; (void)data; (void)write;
 return -ENOTSUP;
}
