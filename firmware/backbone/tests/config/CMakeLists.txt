cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_config_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/config/config.c
  ../../subsys/config/config_cbor.c
  ../../subsys/schema/schema.c
  ../../subsys/module_manager/module_manager.c
  ../../subsys/rule_registry/rule_registry.c
  ../../subsys/resources/resources_note_weak.c
)

target_include_directories(app PRIVATE
  ../../include
)

zephyr_linker_sources(SECTIONS ../../subsys/rule_registry/rule_sections.ld)
