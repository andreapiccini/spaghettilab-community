cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_capabilities_test)

try_compile(
  SPAGHETTI_INVALID_RESOURCE_CONTRACT_COMPILED
  ${CMAKE_CURRENT_BINARY_DIR}/negative-contract
  SOURCES ${CMAKE_CURRENT_SOURCE_DIR}/src/invalid_contract.c
  CMAKE_FLAGS -DCMAKE_C_STANDARD=11
)
if(SPAGHETTI_INVALID_RESOURCE_CONTRACT_COMPILED)
  message(FATAL_ERROR "The deliberately invalid resource contract compiled")
endif()

target_sources(app PRIVATE
  src/main.c
  ../../subsys/core/capabilities.c
)

target_include_directories(app PRIVATE
  ../../include
)
