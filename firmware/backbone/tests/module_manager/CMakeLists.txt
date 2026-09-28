cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_module_manager_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/module_manager/module_manager.c
  ../../subsys/schema/schema.c
  ../../subsys/resources/resources_note_weak.c
)

target_include_directories(app PRIVATE
  ../../include
)
