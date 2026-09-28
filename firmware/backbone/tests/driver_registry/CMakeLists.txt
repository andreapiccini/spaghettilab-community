cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_driver_registry_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/driver_registry/driver_registry.c
  ../../subsys/schema/schema.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/driver_registry
)

zephyr_linker_sources(SECTIONS ../../subsys/driver_registry/driver_sections.ld)
