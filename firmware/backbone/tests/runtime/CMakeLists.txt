cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_runtime_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/data/data.c
  ../../subsys/data/record_delivery.c
  ../../subsys/schema/schema.c
  ../../subsys/rule_registry/rule_registry.c
  ../../subsys/runtime/runtime.c
  ../../subsys/resources/resources_note_weak.c
  ../../spaghetti_rules/threshold/threshold.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../spaghetti_rules/threshold
)

zephyr_linker_sources(SECTIONS ../../subsys/core/health_sections.ld)
zephyr_linker_sources(SECTIONS ../../subsys/rule_registry/rule_sections.ld)
zephyr_linker_sources(SECTIONS ../../subsys/data/record_delivery_sections.ld)
