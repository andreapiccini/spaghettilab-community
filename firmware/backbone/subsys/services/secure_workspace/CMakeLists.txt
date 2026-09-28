target_sources(app PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/secure_workspace.c
  ${CMAKE_CURRENT_LIST_DIR}/secure_workspace_allocator_libc.c
)

target_include_directories(app PRIVATE
  ${ZEPHYR_BASE}/lib/libc/common/include
)
