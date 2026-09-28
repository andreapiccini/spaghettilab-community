cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_ble_protocol_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/communication/ble.c
  ../../subsys/communication/protocol_cbor.c
  ../../subsys/communication/protocol_status.c
  ../../subsys/data/record_delivery.c
  ../../subsys/data/record_consumer_ble.c
  ../../subsys/resources/resources_note_weak.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/communication
)

zephyr_linker_sources(SECTIONS ../../subsys/data/record_delivery_sections.ld)
