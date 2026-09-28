#include "core_boot_internal.h"

#include <zephyr/sys/reboot.h>

void spaghetti_core_boot_reboot(void)
{
	sys_reboot(SYS_REBOOT_WARM);
}
