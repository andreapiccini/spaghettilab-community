cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_communication_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/communication/communication.c
  ../../subsys/communication/protocol_cbor.c
  ../../subsys/communication/protocol_status.c
  ../../subsys/communication/ops_helpers.c
  ../../subsys/communication/communication_shell.c
  ../../subsys/communication/usb_protocol_framing.c
  ../../subsys/communication/usb_protocol.c
  ../../subsys/communication/operations/catalog.c
  ../../subsys/communication/operations/status.c
  ../../subsys/topology/physical.c
  ../../subsys/communication/operations/physical_ops.c
  ../../subsys/nfc/nfc_disabled.c
  ../../subsys/communication/operations/config_ops.c
  ../../subsys/communication/operations/discovery_ops.c
  ../../subsys/communication/operations/module_command.c
  ../../subsys/communication/operations/update_ops.c
  ../../subsys/communication/operations/capabilities_ops.c
  ../../subsys/communication/operations/connectivity_ops.c
  ../../subsys/communication/operations/reset_ops.c
  ../../subsys/communication/operations/audit_ops.c
  ../../subsys/communication/operations/job_ops.c
  ../../subsys/communication/operations/topology_ops.c
  ../../subsys/communication/operations/resources_ops.c
  ../../subsys/communication/operations/features_ops.c
  ../../subsys/communication/operations/device_profile_ops.c
)

zephyr_linker_sources(SECTIONS ../../subsys/communication/operation_sections.ld)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/communication
)
