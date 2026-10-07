cmake_minimum_required(VERSION 3.20.0)

list(APPEND BOARD_ROOT ${CMAKE_CURRENT_SOURCE_DIR})

find_package(Zephyr REQUIRED HINTS $ENV{ZEPHYR_BASE})
project(esp32c3_app)

find_package(Python3 REQUIRED COMPONENTS Interpreter)

add_subdirectory(subsys/connectivity)
add_subdirectory(subsys/services/secure_workspace)

target_sources(app PRIVATE
  subsys/services/service_manager.c
  subsys/services/service_thread.c
  subsys/services/service_registry.c
)

add_custom_target(spaghetti_validator
  COMMAND
    ${Python3_EXECUTABLE}
    ${CMAKE_CURRENT_SOURCE_DIR}/validator
    --cmake-sources
    "$<TARGET_GENEX_EVAL:app,$<JOIN:$<TARGET_PROPERTY:app,SOURCES>,|>>"
    --cmake-includes
    "$<TARGET_GENEX_EVAL:app,$<JOIN:$<TARGET_PROPERTY:app,INCLUDE_DIRECTORIES>,|>>"
  WORKING_DIRECTORY ${CMAKE_CURRENT_SOURCE_DIR}
  DEPENDS
    ${CMAKE_CURRENT_SOURCE_DIR}/validator
    ${CMAKE_CURRENT_SOURCE_DIR}/FIRMWARE_IMPLEMENTATION_GUIDE.md
  COMMENT "Validating Spaghetti LAB firmware conventions"
  VERBATIM
  USES_TERMINAL
)

add_dependencies(app spaghetti_validator)

target_sources(app PRIVATE
  src/main.c
  spaghetti_modules/ina219/ina219.c
  spaghetti_modules/relay/relay.c
  spaghetti_modules/declarative_device/declarative_device.c
  spaghetti_modules/digital_input_trigger/digital_input_trigger.c
  spaghetti_modules/digital_line_set/digital_line_set.c
  spaghetti_modules/on_boot/on_boot.c
  spaghetti_rules/threshold/threshold.c
  spaghetti_blocks/blocks_math.c
  spaghetti_blocks/blocks_bitwise.c
  spaghetti_blocks/blocks_filter.c
  spaghetti_blocks/blocks_logic.c
  spaghetti_blocks/blocks_table.c
  spaghetti_blocks/blocks_publish.c
  spaghetti_blocks/blocks_physical_io.c
  spaghetti_blocks/blocks_kalman.c
  subsys/core/capabilities.c
  subsys/core/core.c
  subsys/core/core_boot_backend.c
  subsys/core/factory_reset.c
  subsys/core/health.c
  subsys/feature_registry/feature_registry.c
  subsys/feature_registry/image_manifest.c
  subsys/feature_registry/pack_core_basic.c
  subsys/feature_registry/pack_processing_basic.c
  subsys/feature_registry/pack_processing_kalman.c
  subsys/feature_registry/pack_device_profile.c
  subsys/feature_registry/pack_transport_modbus.c
  subsys/resources/resources.c
  subsys/resources/resources_note_weak.c
  subsys/port/port.c
  subsys/topology/physical.c
  subsys/port/port_backend_board.c
  subsys/topology/topology.c
  subsys/schema/schema.c
  subsys/device_profiles/device_profile.c
  subsys/device_profiles/device_profile_exec.c
  subsys/driver_registry/driver_registry.c
  subsys/rule_registry/rule_registry.c
  subsys/block_registry/block_registry.c
  subsys/module_manager/module_manager.c
  subsys/discovery/discovery.c
  subsys/discovery/identity_record.c
  subsys/config/config.c
  subsys/config/config_cbor.c
  subsys/config/config_cbor_legacy.c
  subsys/config/legacy_driver_config.c
  subsys/services/storage/storage.c
  subsys/services/storage/storage_legacy_v3.c
  subsys/services/identity/identity.c
  subsys/services/identity/access_control.c
  subsys/services/identity/enrollment.c
  subsys/services/maintenance_link/maintenance_link.c
  subsys/services/maintenance_link/maintenance_mgmt.c
  subsys/services/ota/ota.c
  subsys/services/ota/ota_ble.c
  subsys/services/update/update.c
  subsys/services/update/update_mcuboot.c
  subsys/data/data.c
  subsys/data/record_delivery.c
  subsys/data/record_consumer_ble.c
  subsys/services/timer/timer.c
  subsys/processing/processing.c
  subsys/runtime/runtime.c
  subsys/communication/communication.c
  subsys/communication/protocol_cbor.c
  subsys/communication/protocol_status.c
  subsys/communication/ops_helpers.c
  subsys/communication/communication_shell.c
  subsys/communication/usb_protocol_framing.c
  subsys/communication/usb_protocol.c
  subsys/communication/remote_console.c
  subsys/communication/operations/catalog.c
  subsys/communication/operations/status.c
  subsys/communication/operations/config_ops.c
  subsys/communication/operations/discovery_ops.c
  subsys/communication/operations/module_command.c
  subsys/communication/operations/update_ops.c
  subsys/communication/operations/capabilities_ops.c
  subsys/communication/operations/connectivity_ops.c
  subsys/communication/operations/reset_ops.c
  subsys/communication/operations/audit_ops.c
  subsys/communication/operations/job_ops.c
  subsys/communication/operations/topology_ops.c
  subsys/communication/operations/physical_ops.c
  subsys/communication/operations/resources_ops.c
  subsys/communication/operations/features_ops.c
  subsys/communication/operations/device_profile_ops.c
  subsys/services/mqtt/mqtt_credentials.c
)

if(CONFIG_SPAGHETTI_NFC)
  target_sources(app PRIVATE
    subsys/nfc/nfc.c
  )
else()
  target_sources(app PRIVATE
    subsys/nfc/nfc_disabled.c
  )
endif()

if(CONFIG_SPAGHETTI_FIELD_UPDATE)
  target_sources(app PRIVATE
    subsys/services/ota/field_update.c
  )
endif()

if(CONFIG_SPAGHETTI_FIELD_UPDATE_CAN)
  target_sources(app PRIVATE
    subsys/services/ota/field_update_can.c
  )
endif()

if(CONFIG_SPAGHETTI_FIELD_UPDATE_ESPNOW)
  target_sources(app PRIVATE
    subsys/services/ota/field_update_espnow.c
  )
endif()

if(CONFIG_WIFI)
  target_sources(app PRIVATE
    subsys/services/wifi_profiles/wifi_profiles.c
    subsys/services/wifi_profiles/wifi_profiles_storage.c
    subsys/services/ota/ota_dtls.c
  )
else()
  target_sources(app PRIVATE
    subsys/services/wifi_profiles/wifi_profiles_disabled.c
    subsys/services/ota/ota_dtls_disabled.c
  )
endif()

if(CONFIG_MQTT_LIB)
  target_sources(app PRIVATE
    subsys/services/mqtt/mqtt.c
  )
else()
  target_sources(app PRIVATE
    subsys/services/mqtt/mqtt_disabled.c
  )
endif()

if(CONFIG_SPAGHETTI_REMOTE_CONSOLE)
  target_sources(app PRIVATE
    subsys/communication/remote_console_tls.c
  )
else()
  target_sources(app PRIVATE
    subsys/communication/remote_console_disabled.c
  )
endif()

if(CONFIG_BT)
  target_sources(app PRIVATE
    subsys/communication/ble.c
  )
else()
  target_sources(app PRIVATE
    subsys/communication/ble_disabled.c
  )
endif()

target_sources_ifdef(CONFIG_SPAGHETTI_POWER app PRIVATE
  subsys/power/power.c
)

target_sources_ifdef(CONFIG_SPAGHETTI_ENERGY app PRIVATE
  subsys/power/energy.c
)

zephyr_linker_sources(SECTIONS subsys/core/health_sections.ld)
zephyr_linker_sources(SECTIONS subsys/driver_registry/driver_sections.ld)
zephyr_linker_sources(SECTIONS subsys/rule_registry/rule_sections.ld)
zephyr_linker_sources(SECTIONS subsys/block_registry/block_sections.ld)
zephyr_linker_sources(SECTIONS subsys/device_profiles/device_profile_sections.ld)
zephyr_linker_sources(SECTIONS subsys/data/record_delivery_sections.ld)
zephyr_linker_sources(SECTIONS subsys/feature_registry/feature_pack_sections.ld)
zephyr_linker_sources(SECTIONS subsys/discovery/discovery_sections.ld)
zephyr_linker_sources(SECTIONS subsys/communication/operation_sections.ld)

get_target_property(APP_SRCS app SOURCES)

message(STATUS "========== APP SOURCES ==========")
foreach(src ${APP_SRCS})
    message(STATUS "  ${src}")
endforeach()

target_include_directories(app PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/include
  ${CMAKE_CURRENT_SOURCE_DIR}/spaghetti_modules/ina219
  ${CMAKE_CURRENT_SOURCE_DIR}/spaghetti_modules/relay
  ${CMAKE_CURRENT_SOURCE_DIR}/spaghetti_modules/declarative_device
  ${CMAKE_CURRENT_SOURCE_DIR}/spaghetti_modules/digital_input_trigger
  ${CMAKE_CURRENT_SOURCE_DIR}/spaghetti_modules/digital_line_set
  ${CMAKE_CURRENT_SOURCE_DIR}/spaghetti_modules/on_boot
  ${CMAKE_CURRENT_SOURCE_DIR}/spaghetti_rules/threshold
  ${CMAKE_CURRENT_SOURCE_DIR}/spaghetti_blocks
)

# Optional, additive integration point for downstream firmware. Community does
# not define this path and therefore remains a complete standalone build.
if(DEFINED SPAGHETTI_FIRMWARE_EXTENSION_DIR)
  get_filename_component(
    SPAGHETTI_FIRMWARE_EXTENSION_DIR
    "${SPAGHETTI_FIRMWARE_EXTENSION_DIR}"
    ABSOLUTE
  )
  include(cmake/SpaghettiFirmwareExtension.cmake)
  spaghetti_validate_firmware_extension("${SPAGHETTI_FIRMWARE_EXTENSION_DIR}")
  message(STATUS
    "Loading downstream firmware extension: ${SPAGHETTI_FIRMWARE_EXTENSION_DIR}"
  )
  add_subdirectory(
    "${SPAGHETTI_FIRMWARE_EXTENSION_DIR}"
    "${CMAKE_CURRENT_BINARY_DIR}/spaghetti_firmware_extension"
  )
endif()

get_target_property(APP_INCLUDES app INCLUDE_DIRECTORIES)

message(STATUS "========== APP INCLUDE DIRS ==========")

foreach(dir ${APP_INCLUDES})
    message(STATUS "  ${dir}")
endforeach()

message(STATUS "======================================")
