cmake_minimum_required(VERSION 3.20.0)
find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_can_transport_test)
target_sources(app PRIVATE src/main.c ../../spaghetti_modules/can_link/can_link.c
 ../../subsys/services/ota/can_rpc.c ../../subsys/communication/protocol_cbor.c
 ../../subsys/schema/schema.c ../../subsys/driver_registry/driver_registry.c)
target_compile_definitions(app PRIVATE CONFIG_SPAGHETTI_FIELD_UPDATE_CAN=1)
target_include_directories(app PRIVATE ../../include ../../subsys/services/ota)
zephyr_linker_sources(SECTIONS ../../subsys/driver_registry/driver_sections.ld)
