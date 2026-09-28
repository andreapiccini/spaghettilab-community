cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_resources_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/feature_registry/feature_registry.c
  ../../subsys/feature_registry/image_manifest.c
  ../../subsys/feature_registry/pack_core_basic.c
  ../../subsys/feature_registry/pack_processing_basic.c
  ../../subsys/feature_registry/pack_processing_kalman.c
  ../../subsys/feature_registry/pack_device_profile.c
  ../../subsys/feature_registry/pack_transport_modbus.c
  ../../subsys/resources/resources.c
  ../../subsys/resources/resources_note_weak.c
)

target_include_directories(app PRIVATE
  ../../include
)

zephyr_linker_sources(SECTIONS
  ../../subsys/feature_registry/feature_pack_sections.ld)
