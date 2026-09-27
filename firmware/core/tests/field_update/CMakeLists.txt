cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_field_update_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/services/ota/field_update.c
  ../../subsys/nfc/nfc_disabled.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/services/ota
)
