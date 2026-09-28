#include <spaghetti/nfc.h>

#include <errno.h>
#include <stddef.h>

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

const char *spaghetti_nfc_type_id(const struct spaghetti_nfc_tag *tag)
{
	(void)tag;
	return "tag";
}
