cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_threshold_test)

target_sources(app PRIVATE
  src/main.c
  ../../spaghetti_rules/threshold/threshold.c
  ../../subsys/schema/schema.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../spaghetti_rules/threshold
)

zephyr_linker_sources(SECTIONS ../../subsys/rule_registry/rule_sections.ld)
