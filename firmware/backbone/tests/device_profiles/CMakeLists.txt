cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_device_profiles_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/device_profiles/device_profile.c
  ../../subsys/device_profiles/device_profile_exec.c
  ../../subsys/schema/schema.c
  ../../subsys/driver_registry/driver_registry.c
  ../../subsys/module_manager/module_manager.c
  ../../subsys/resources/resources_note_weak.c
  ../../spaghetti_modules/declarative_device/declarative_device.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../spaghetti_modules/declarative_device
)

zephyr_linker_sources(SECTIONS ../../subsys/driver_registry/driver_sections.ld)
zephyr_linker_sources(SECTIONS ../../subsys/device_profiles/device_profile_sections.ld)
