cmake_minimum_required(VERSION 3.20.0)

list(APPEND DTS_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../..)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_v1_extension_test)

target_sources(app PRIVATE
  src/main.c
  src/harness.c
  src/fake_temperature.c
  src/fake_button.c
  src/fake_pwm.c
  src/fake_rule.c
  src/fake_register_profiles.c
  src/fake_processing_block.c
  src/fake_eeprom_provider.c
  src/fake_analog_provider.c
  ../../subsys/schema/schema.c
  ../../subsys/driver_registry/driver_registry.c
  ../../subsys/rule_registry/rule_registry.c
  ../../subsys/block_registry/block_registry.c
  ../../subsys/device_profiles/device_profile.c
  ../../subsys/device_profiles/device_profile_exec.c
  ../../subsys/module_manager/module_manager.c
  ../../subsys/config/config.c
  ../../subsys/config/config_cbor.c
  ../../subsys/data/data.c
  ../../subsys/data/record_delivery.c
  ../../subsys/processing/processing.c
  ../../subsys/discovery/discovery.c
  ../../subsys/topology/topology.c
  ../../subsys/power/power.c
  ../../subsys/resources/resources_note_weak.c
  ../../spaghetti_modules/declarative_device/declarative_device.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/driver_registry
  ../../subsys/rule_registry
  ../../subsys/block_registry
  ../../subsys/device_profiles
  ../../subsys/topology
  ../../subsys/power
  ../../subsys/discovery
  ../../spaghetti_modules/declarative_device
  src
)

zephyr_linker_sources(SECTIONS ../../subsys/driver_registry/driver_sections.ld)
zephyr_linker_sources(SECTIONS ../../subsys/rule_registry/rule_sections.ld)
zephyr_linker_sources(SECTIONS ../../subsys/block_registry/block_sections.ld)
zephyr_linker_sources(SECTIONS
  ../../subsys/device_profiles/device_profile_sections.ld)
zephyr_linker_sources(SECTIONS
  ../../subsys/discovery/discovery_sections.ld)
zephyr_linker_sources(SECTIONS
  ../../subsys/data/record_delivery_sections.ld)
zephyr_linker_sources(SECTIONS ../../subsys/core/health_sections.ld)
