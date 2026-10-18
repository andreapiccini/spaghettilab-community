/* Dedicated product diagnostics; no host/master or arbitrary pin commands. */
#include <spaghetti/core.h>
#include <spaghetti/field_update.h>
#include <spaghetti/nfc.h>
#include <spaghetti/physical.h>
#include <zephyr/shell/shell.h>
#include <errno.h>

static int cmd_nfc_module(const struct shell *shell, size_t argc, char **argv)
{
	struct spaghetti_core_info info;
	struct spaghetti_nfc_tag tags[2];
	uint8_t descriptor[SPAGHETTI_PHYSICAL_SIZE];
	size_t count = 0U;
	int err;

	ARG_UNUSED(argc);
	ARG_UNUSED(argv);
	err = spaghetti_core_get_info(&info);
	if (err < 0) {
		return err;
	}
	shell_print(shell, "product=NFC_MODULE version=%s node=0x%06x", info.version,
		    spaghetti_field_update_local_node_id());
	shell_print(shell, "role=CAN_PERIPHERAL master=NEVER flags=0x%02x chain=%u",
		    spaghetti_field_update_local_flags(),
		    spaghetti_field_update_local_chain_index());
	const int physical = spaghetti_physical_describe(descriptor);
	const int slot_one = spaghetti_field_update_set_chain_index(1U);
	const int discover = spaghetti_field_update_discover(NULL, 0U, &count);
	const bool safe = physical == -ENOTSUP && slot_one == -EINVAL &&
			  discover == -ENOTSUP;

	shell_print(shell, "policy: physical=%d master_slot=%d discover=%d %s",
		    physical, slot_one, discover, safe ? "PASS" : "FAIL");
	(void)spaghetti_nfc_copy_tags(tags, ARRAY_SIZE(tags), &count);
	shell_print(shell, "tags=%u", (unsigned int)count);
	for (size_t i = 0U; i < count; i++) {
		shell_print(shell, "antenna=%u type=%s UID:", tags[i].antenna,
			    spaghetti_nfc_type_id(&tags[i]));
		shell_hexdump(shell, tags[i].uid, tags[i].uid_len);
	}
	return 0;
}

SHELL_CMD_REGISTER(nfcmodule, NULL,
		   "NFC product identity, safety policy self-test and cached tags",
		   cmd_nfc_module);
