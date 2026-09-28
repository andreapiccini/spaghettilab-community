# Communication operations

[← Communication](../README.md)

Protocol V1 operation handlers are registered through
`SPAGHETTI_OPERATION_HANDLER_DEFINE` into the
`spaghetti_operation_handler` iterable section. Communication discovers them
at init, authorizes through Access Control, and schedules by execution class.

| File | Operations |
|---|---|
| `catalog.c` | GET_CATALOG |
| `status.c` | GET_STATUS |
| `config_ops.c` | GET/VALIDATE/APPLY_CONFIG |
| `discovery_ops.c` | LIST/SCAN/ACCEPT_DISCOVERY |
| `module_command.c` | MODULE_COMMAND |
| `update_ops.c` | GET_UPDATE_STATUS, OPEN/WRITE/FINISH/CANCEL_BLE_UPDATE |
| `capabilities_ops.c` | GET_CAPABILITIES |
| `connectivity_ops.c` | connectivity status/lease/maintenance/Wi-Fi update handover |
| `reset_ops.c` | FACTORY_RESET |
| `audit_ops.c` | GET_AUDIT_LOG |
| `job_ops.c` | GET_JOB_STATUS |
| `topology_ops.c` | GET_TOPOLOGY |
| `resources_ops.c` | GET_RESOURCES |
| `features_ops.c` | GET_FEATURES |
| `device_profile_ops.c` | device profile list/get/validate/install/remove |
