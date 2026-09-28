cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_fuzz_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/communication/protocol_cbor.c
  ../../subsys/communication/protocol_status.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/communication
)
