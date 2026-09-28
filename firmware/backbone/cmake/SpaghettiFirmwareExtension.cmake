set(SPAGHETTI_FIRMWARE_EXTENSION_API_VERSION 1)
set(SPAGHETTI_FIRMWARE_EXTENSION_CONTRACT "spaghettilab.firmware-extension")

function(spaghetti_validate_firmware_extension extension_dir)
  get_filename_component(_extension_dir "${extension_dir}" ABSOLUTE)
  set(_manifest_path "${_extension_dir}/spaghetti-extension.json")

  if(NOT EXISTS "${_manifest_path}")
    message(FATAL_ERROR
      "Firmware extension is missing spaghetti-extension.json: ${_extension_dir}"
    )
  endif()
  if(NOT EXISTS "${_extension_dir}/CMakeLists.txt")
    message(FATAL_ERROR
      "Firmware extension is missing CMakeLists.txt: ${_extension_dir}"
    )
  endif()

  file(READ "${_manifest_path}" _manifest)
  string(JSON _contract GET "${_manifest}" contract)
  string(JSON _api_version GET "${_manifest}" api_version)

  if(NOT _contract STREQUAL SPAGHETTI_FIRMWARE_EXTENSION_CONTRACT)
    message(FATAL_ERROR
      "Unsupported firmware extension contract '${_contract}'; expected "
      "'${SPAGHETTI_FIRMWARE_EXTENSION_CONTRACT}'"
    )
  endif()
  if(NOT _api_version EQUAL SPAGHETTI_FIRMWARE_EXTENSION_API_VERSION)
    message(FATAL_ERROR
      "Incompatible firmware extension API ${_api_version}; Community requires "
      "${SPAGHETTI_FIRMWARE_EXTENSION_API_VERSION}"
    )
  endif()

  message(STATUS
    "Validated firmware extension API ${_api_version}: ${_extension_dir}"
  )
endfunction()
