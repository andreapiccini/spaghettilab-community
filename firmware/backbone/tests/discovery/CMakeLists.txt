cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_discovery_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/discovery/discovery.c
  ../../subsys/discovery/identity_record.c
)

target_include_directories(app PRIVATE
  ../../include
)

zephyr_linker_sources(SECTIONS
  ../../subsys/discovery/discovery_sections.ld)
