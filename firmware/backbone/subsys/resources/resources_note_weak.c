#include <spaghetti/resources.h>

#include <zephyr/sys/util.h>
#include <zephyr/toolchain.h>

/*
 * Weak defaults so unit tests that link instrumented subsystems without
 * resources.c still resolve these symbols. The strong implementations in
 * resources.c override these when present.
 */
void __weak spaghetti_resources_note_used(enum spaghetti_resource_owner owner,
					  uint16_t used)
{
	ARG_UNUSED(owner);
	ARG_UNUSED(used);
}

void __weak spaghetti_resources_note_failure(enum spaghetti_resource_owner owner)
{
	ARG_UNUSED(owner);
}
