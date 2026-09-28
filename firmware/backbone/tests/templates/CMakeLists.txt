cmake_minimum_required(VERSION 3.20.0)

list(APPEND DTS_ROOT ${CMAKE_CURRENT_SOURCE_DIR}/../..)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_templates_test)

set(TPL_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../templates/firmware)
set(GEN_DIR ${CMAKE_CURRENT_BINARY_DIR}/from_templates)

file(MAKE_DIRECTORY ${GEN_DIR})

# Clean-room instantiation: copy templates verbatim (no central subsystem patches).
configure_file(${TPL_DIR}/module_driver.h.template
	       ${GEN_DIR}/example_module.h COPYONLY)
configure_file(${TPL_DIR}/module_driver.c.template
	       ${GEN_DIR}/example_module.c COPYONLY)
configure_file(${TPL_DIR}/block_driver.c.template
	       ${GEN_DIR}/example_block.c COPYONLY)
configure_file(${TPL_DIR}/feature_pack.c.template
	       ${GEN_DIR}/example_pack.c COPYONLY)
configure_file(${TPL_DIR}/device_profile.c.template
	       ${GEN_DIR}/example_device_profile.c COPYONLY)

target_sources(app PRIVATE
  src/main.c
  ${GEN_DIR}/example_module.c
  ${GEN_DIR}/example_block.c
  ${GEN_DIR}/example_pack.c
  ${GEN_DIR}/example_device_profile.c
  ../../subsys/schema/schema.c
  ../../subsys/driver_registry/driver_registry.c
  ../../subsys/block_registry/block_registry.c
  ../../subsys/feature_registry/feature_registry.c
  ../../subsys/feature_registry/image_manifest.c
  ../../subsys/device_profiles/device_profile.c
  ../../subsys/topology/topology.c
  ../../subsys/resources/resources_note_weak.c
)

target_include_directories(app PRIVATE
  ${GEN_DIR}
  ../../include
  ../../subsys/driver_registry
  ../../subsys/block_registry
  ../../subsys/topology
)

zephyr_linker_sources(SECTIONS ../../subsys/driver_registry/driver_sections.ld)
zephyr_linker_sources(SECTIONS ../../subsys/block_registry/block_sections.ld)
zephyr_linker_sources(SECTIONS
  ../../subsys/feature_registry/feature_pack_sections.ld)
zephyr_linker_sources(SECTIONS
  ../../subsys/device_profiles/device_profile_sections.ld)
