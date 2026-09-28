-include .env

COMPOSE := docker compose
VALIDATOR_QUIET_VALUES := 1 true yes on
VALIDATOR_IS_QUIET := $(filter $(VALIDATOR_QUIET_VALUES),$(VALIDATOR_QUIET))
VALIDATOR_ENV := $(if $(VALIDATOR_IS_QUIET),SPAGHETTI_VALIDATOR_QUIET=1 ,)
HOST_PYTHON := python3
ifeq ($(OS),Windows_NT)
HOST_PYTHON := py -3
HOST_VENV_PYTHON := .venv/Scripts/python.exe
else
HOST_VENV_PYTHON := .venv/bin/python
endif
HOST_TOOLS_STAMP := .venv/.spaghetti-host-tools-ready
CREDENTIALS ?= .keys/remote-console.json
PORT_ARG := $(if $(strip $(PORT)),--port "$(PORT)",)
HOST_ARG := $(if $(strip $(HOST)),--host "$(HOST)",)
CREDENTIALS_ARG := $(if $(strip $(CREDENTIALS)),--credentials "$(CREDENTIALS)",)
IDENTITY ?= core-v1
SUBNET_ARG := $(if $(strip $(SUBNET)),--subnet "$(SUBNET)",)
REMOTE_CONSOLE_PORT ?= 1338
QUALIFICATION_BOARD_REVISION ?= prototype-v1
QUALIFICATION_DEVICE_SERIAL ?=
TRANSPORT ?= auto
BAUD ?= 115200
FLASH_BAUD ?= 460800
MCUBOOT_DEV_KEY := .keys/mcuboot-dev-ecdsa-p256.pem
WEST_BUILD := west build --sysbuild
# Optional extra Kconfig overlay. BLE-only image: make build-ble.
EXTRA_CONF_FILE ?=
WEST_CMAKE_ARGS := -- -DBOARD_ROOT=/opt/zephyrproject/app \
	-DDTS_ROOT=/opt/zephyrproject/app \
	$(if $(strip $(EXTRA_CONF_FILE)),-DEXTRA_CONF_FILE=$(EXTRA_CONF_FILE),)

IMAGE ?= build/app/zephyr/zephyr.signed.bin
TARGET ?= 2

.PHONY: image shell signing-key validate build build-ble pristine flash screen monitor \
	host-tools ports remote-console-credential remote-console-provision \
	remote-console-enable remote-console-clear remote-console-list update-qualification-manifest \
	update-qualification-check resource-report node-red-ble-smoke node-red-mqtt-smoke \
	spaghetti usb-bridge config-validate config-apply slup-load slup-list clean

$(HOST_TOOLS_STAMP): tools/requirements.txt
	@$(HOST_PYTHON) -m venv .venv
	@$(HOST_VENV_PYTHON) -m pip install --disable-pip-version-check \
		-r tools/requirements.txt
	@$(HOST_VENV_PYTHON) -c \
		"from pathlib import Path; Path('$(HOST_TOOLS_STAMP)').touch()"
	@# Install loopback CLI name used by docs / TASK-375.
ifeq ($(OS),Windows_NT)
	@$(HOST_VENV_PYTHON) -c \
		"from pathlib import Path; p=Path('.venv/Scripts/spaghetti-gateway.cmd'); \
		p.write_text('@echo off\r\n\"%~dp0python.exe\" -m tools.spaghetti_gateway %*\r\n', encoding='utf-8')"
else
	@printf '%s\n' '#!/bin/sh' \
		'ROOT="$$(CDPATH= cd -- "$$(dirname "$$0")/../.." && pwd)"' \
		'export PYTHONPATH="$$ROOT$${PYTHONPATH:+:$$PYTHONPATH}"' \
		'exec "$$(dirname "$$0")/python" -m tools.spaghetti_gateway "$$@"' \
		> .venv/bin/spaghetti-gateway
	@chmod +x .venv/bin/spaghetti-gateway
endif

host-tools: $(HOST_TOOLS_STAMP)

# Spaghetti CLI V1 (catalog-driven JSON Config / Protocol). Pass ARGS='…'.
spaghetti: host-tools
	@$(HOST_VENV_PYTHON) tools/spaghetti.py $(ARGS)

# USB Serial/JTAG → ws://127.0.0.1:8766 for Safari / browsers without Web Serial.
# Close make monitor first. React Flow: software/micro-flow-editor `make up-d`.
usb-bridge: host-tools
	@PYTHONPATH=. $(HOST_VENV_PYTHON) -m tools.usb_bridge

# CONFIG is a local JSON path (not a Kconfig symbol).
config-validate: host-tools
	@$(HOST_VENV_PYTHON) tools/spaghetti.py config validate "$(CONFIG)"

config-apply: host-tools
	@$(HOST_VENV_PYTHON) tools/spaghetti.py config apply "$(CONFIG)"

# Fake MQTT → TypeScript SpaghettiClient smoke (no broker, no Node-RED process).
# Shared CBOR vectors: ../../contracts/protocol-v1/vectors/v1/.
node-red-mqtt-smoke: host-tools
	@npm --prefix tools/sdk/typescript ci --silent
	@npm --prefix tools/sdk/typescript run build --silent
	@node tools/sdk/typescript/scripts/mqtt-smoke.mjs

# Fake BLE → gateway → WebSocket CBOR smoke (no radio, no Node-RED process).
node-red-ble-smoke: host-tools
	@PYTHONPATH=. $(HOST_VENV_PYTHON) -m tools.spaghetti_gateway.smoke

image:
	@$(COMPOSE) build

shell:
	@$(COMPOSE) run --rm --entrypoint /bin/bash dev

signing-key:
	@$(COMPOSE) run --rm --entrypoint sh dev -lc \
		'set -eu; \
		if [ -e "$(MCUBOOT_DEV_KEY)" ]; then \
			echo "Keeping existing development signing key: $(MCUBOOT_DEV_KEY)"; \
			exit 0; \
		fi; \
		umask 077; \
		mkdir -p .keys; \
		imgtool keygen -k "$(MCUBOOT_DEV_KEY)" -t ecdsa-p256; \
		echo "Created development-only signing key: $(MCUBOOT_DEV_KEY)"; \
		echo "Back it up: replacing it requires reprovisioning MCUboot."'

validate:
	@$(COMPOSE) run --rm --entrypoint sh dev -lc \
		'test -f "$(MCUBOOT_DEV_KEY)" || { \
			echo "Missing $(MCUBOOT_DEV_KEY); run make signing-key first."; \
			exit 2; \
		}; \
		SPAGHETTI_VALIDATOR_QUIET=$(if $(VALIDATOR_IS_QUIET),1,0) $(WEST_BUILD) \
			-p auto -b "$$BOARD" -d build --cmake-only . \
			$(WEST_CMAKE_ARGS); \
		SPAGHETTI_VALIDATOR_QUIET=$(if $(VALIDATOR_IS_QUIET),1,0) cmake \
			--build build/app --target spaghetti_validator'

build:
	@$(COMPOSE) run --rm --entrypoint sh dev -lc \
		'set -e; \
		test -f "$(MCUBOOT_DEV_KEY)" || { \
			echo "Missing $(MCUBOOT_DEV_KEY); run make signing-key first."; \
			exit 2; \
		}; \
		if [ -d build ] && [ ! -f build/build.ninja ]; then \
			echo "Incomplete build directory detected; regenerating."; \
			cmake -E remove_directory build; \
		fi; \
		$(VALIDATOR_ENV)$(WEST_BUILD) \
			-p auto -b "$$BOARD" -d build . $(WEST_CMAKE_ARGS)'

build-ble:
	@$(COMPOSE) run --rm --entrypoint sh dev -lc \
		'set -e; \
		test -f "$(MCUBOOT_DEV_KEY)" || { \
			echo "Missing $(MCUBOOT_DEV_KEY); run make signing-key first."; \
			exit 2; \
		}; \
		if [ -d build-ble ] && [ ! -f build-ble/build.ninja ]; then \
			echo "Incomplete build-ble directory detected; regenerating."; \
			cmake -E remove_directory build-ble; \
		fi; \
		$(VALIDATOR_ENV)$(WEST_BUILD) \
			-p auto -b "$$BOARD" -d build-ble . \
			-- -DBOARD_ROOT=/opt/zephyrproject/app \
			-DDTS_ROOT=/opt/zephyrproject/app \
			-DEXTRA_CONF_FILE=overlay-ble.conf'

pristine:
	@$(COMPOSE) run --rm --entrypoint sh dev -lc \
		'set -e; \
		test -f "$(MCUBOOT_DEV_KEY)" || { \
			echo "Missing $(MCUBOOT_DEV_KEY); run make signing-key first."; \
			exit 2; \
		}; \
		cmake -E remove_directory build; \
		$(VALIDATOR_ENV)$(WEST_BUILD) \
			-p auto -b "$$BOARD" -d build . $(WEST_CMAKE_ARGS)'

flash:
	@$(HOST_PYTHON) tools/device.py flash $(PORT_ARG) --baud "$(FLASH_BAUD)"

screen:
	@$(HOST_PYTHON) tools/device.py screen $(PORT_ARG) --baud "$(BAUD)"

monitor: $(HOST_TOOLS_STAMP)
	@$(HOST_VENV_PYTHON) tools/device.py monitor --transport "$(TRANSPORT)" \
		$(PORT_ARG) $(HOST_ARG) $(CREDENTIALS_ARG) --baud "$(BAUD)"

# Close make monitor first. IMAGE is a host path; TARGET is slup idx or 0xNODE.
slup-load: $(HOST_TOOLS_STAMP)
	@PYTHONPATH=. $(HOST_VENV_PYTHON) tools/slup_load.py \
		--image "$(IMAGE)" --target "$(TARGET)" $(PORT_ARG)

slup-list: $(HOST_TOOLS_STAMP)
	@PYTHONPATH=. $(HOST_VENV_PYTHON) tools/slup_load.py --list $(PORT_ARG)

remote-console-credential:
	@$(HOST_PYTHON) tools/device.py remote-console-credential \
		$(CREDENTIALS_ARG) --identity "$(IDENTITY)"

remote-console-provision: $(HOST_TOOLS_STAMP)
	@$(HOST_VENV_PYTHON) tools/device.py remote-console-provision \
		$(PORT_ARG) $(CREDENTIALS_ARG) --baud "$(BAUD)"

remote-console-enable: $(HOST_TOOLS_STAMP)
	@$(HOST_VENV_PYTHON) tools/device.py remote-console-enable \
		$(PORT_ARG) $(CREDENTIALS_ARG) --identity "$(IDENTITY)" \
		--baud "$(BAUD)"

remote-console-clear: $(HOST_TOOLS_STAMP)
	@$(HOST_VENV_PYTHON) tools/device.py remote-console-clear \
		$(PORT_ARG) --baud "$(BAUD)"

remote-console-list: $(HOST_TOOLS_STAMP)
	@$(HOST_VENV_PYTHON) tools/device.py remote-console-list \
		$(SUBNET_ARG) $(CREDENTIALS_ARG) \
		--network-port "$(REMOTE_CONSOLE_PORT)"

update-qualification-manifest:
	@$(HOST_PYTHON) tools/update_qualification.py manifest \
		--board-revision "$(QUALIFICATION_BOARD_REVISION)" \
		--device-serial "$(QUALIFICATION_DEVICE_SERIAL)"

update-qualification-check:
	@$(HOST_PYTHON) tools/update_qualification.py check-report

resource-report:
	@$(HOST_PYTHON) tools/resource_report.py --profile minimal \
		--out-dir build/resource-report
	@$(HOST_PYTHON) tools/resource_report.py --profile standard \
		--out-dir build/resource-report
	@$(HOST_PYTHON) tools/resource_report.py --profile all-supported \
		--out-dir build/resource-report

ports:
	@$(HOST_PYTHON) tools/device.py ports

clean:
	@$(COMPOSE) run --rm --entrypoint west dev build -d build -t pristine
