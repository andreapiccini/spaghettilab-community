cmake_minimum_required(VERSION 3.20.0)

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(spaghetti_processing_test)

target_sources(app PRIVATE
  src/main.c
  ../../subsys/block_registry/block_registry.c
  ../../subsys/processing/processing.c
  ../../subsys/schema/schema.c
  ../../subsys/resources/resources_note_weak.c
  ../../spaghetti_blocks/blocks_math.c
  ../../spaghetti_blocks/blocks_bitwise.c
  ../../spaghetti_blocks/blocks_filter.c
  ../../spaghetti_blocks/blocks_logic.c
  ../../spaghetti_blocks/blocks_table.c
  ../../spaghetti_blocks/blocks_publish.c
  ../../spaghetti_blocks/blocks_kalman.c
)

target_include_directories(app PRIVATE
  ../../include
  ../../subsys/block_registry
  ../../spaghetti_blocks
)

zephyr_linker_sources(SECTIONS ../../subsys/block_registry/block_sections.ld)
