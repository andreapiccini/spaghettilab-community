cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_storage_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/services/storage/storage.c
  ../../subsys/services/storage/storage_legacy_v3.c
  ../../subsys/config/config_cbor.c
  ../../subsys/config/config_cbor_legacy.c
  ../../subsys/config/legacy_driver_config.c
  ../../spaghetti_modules/ina219/ina219.c
  ../../spaghetti_modules/relay/relay.c
  ../../subsys/schema/schema.c
)

target_include_directories(app BEFORE PRIVATE
  include
  ../../include
  ../../spaghetti_modules/ina219
  ../../spaghetti_modules/relay
  ../../subsys/services/storage
)

zephyr_linker_sources(SECTIONS ../../subsys/driver_registry/driver_sections.ld)
