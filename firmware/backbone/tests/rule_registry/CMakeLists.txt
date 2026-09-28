cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_rule_registry_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/rule_registry/rule_registry.c
  ../../subsys/schema/schema.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/rule_registry
)

zephyr_linker_sources(SECTIONS ../../subsys/rule_registry/rule_sections.ld)
