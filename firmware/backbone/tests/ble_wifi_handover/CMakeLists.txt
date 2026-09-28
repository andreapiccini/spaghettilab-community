cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_ble_wifi_handover_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/connectivity/connectivity.c
  ../../subsys/communication/communication.c
  ../../subsys/communication/protocol_cbor.c
  ../../subsys/communication/protocol_status.c
  ../../subsys/communication/ops_helpers.c
  ../../subsys/communication/operations/connectivity_ops.c
)

zephyr_linker_sources(SECTIONS ../../subsys/communication/operation_sections.ld)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/communication
  ../../subsys/connectivity
)
