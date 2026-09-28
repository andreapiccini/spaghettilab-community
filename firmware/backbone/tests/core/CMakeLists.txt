cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_core_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/core/capabilities.c
  ../../subsys/core/core.c
)

target_include_directories(app PRIVATE
  ../../include
)
