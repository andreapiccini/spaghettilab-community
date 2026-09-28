cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_service_manager_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/services/service_manager.c
  ../../subsys/services/service_thread.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/services
)
