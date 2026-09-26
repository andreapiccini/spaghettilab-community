import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

function usbBridgeProxyTarget(): string {
  return existsSync("/.dockerenv")
    ? "http://host.docker.internal:8766"
    : "http://127.0.0.1:8766";
}

/** Host-only: Docker on macOS cannot open USB serial. `make up-d` starts the same script. */
function spaghettiUsbBridge(): Plugin {
  return {
    name: "spaghetti-usb-bridge",
    configureServer() {
      if (existsSync("/.dockerenv")) return;
      const script = fileURLToPath(
        new URL("../../scripts/usb-bridge.sh", import.meta.url),
      );
      spawn("sh", [script, "start"], { detached: true, stdio: "ignore" }).unref();
    },
  };
}

const extensionModuleId = "virtual:spaghettilab-extensions";
const resolvedExtensionModuleId = `\0${extensionModuleId}`;

/**
 * Downstream builds may inject one manifest without adding a Community
 * dependency on the downstream repository. The default module is a no-op.
 */
function spaghettiExtensions(): Plugin {
  const configuredPath = process.env.SPAGHETTI_SOFTWARE_EXTENSION_MANIFEST;
  const manifestPath = configuredPath ? resolve(configuredPath) : undefined;

  if (manifestPath && !existsSync(manifestPath)) {
    throw new Error(
      `SPAGHETTI_SOFTWARE_EXTENSION_MANIFEST does not exist: ${manifestPath}`,
    );
  }
  if (manifestPath) {
    const admissionPath = resolve(
      dirname(manifestPath),
      "spaghetti-studio-extension.json",
    );
    if (!existsSync(admissionPath))
      throw new Error(
        `Studio extension is missing spaghetti-studio-extension.json: ${dirname(manifestPath)}`,
      );
    const admission = JSON.parse(readFileSync(admissionPath, "utf8")) as {
      contract?: unknown;
      api_version?: unknown;
    };
    if (admission.contract !== "spaghettilab.studio-extension")
      throw new Error(
        `Unsupported Studio extension contract: ${String(admission.contract)}`,
      );
    if (admission.api_version !== 1)
      throw new Error(
        `Incompatible Studio extension API ${String(admission.api_version)}; Community requires 1`,
      );
  }

  return {
    name: "spaghetti-extensions",
    resolveId(id) {
      if (id !== extensionModuleId) return undefined;
      return manifestPath ?? resolvedExtensionModuleId;
    },
    load(id) {
      if (id !== resolvedExtensionModuleId) return undefined;
      if (!manifestPath) {
        return "export function installProductionExtensions() {}";
      }
      return `${readFileSync(manifestPath, "utf8")}\n//# sourceURL=${pathToFileURL(manifestPath).href}`;
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Relative base so a static build can live on GitHub Pages (or any subpath).
  base: "./",
  plugins: [react(), tailwindcss(), spaghettiUsbBridge(), spaghettiExtensions()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    // Required so Vite's dev-server file watcher works when the source
    // tree is bind-mounted from the host into the container.
    watch: {
      usePolling: true,
    },
    // Safari talks only to :5173. Docker Vite forwards to the host USB bridge.
    proxy: {
      "/usb-bridge": {
        target: usbBridgeProxyTarget(),
        changeOrigin: true,
        ws: true,
        rewrite: (path) => path.replace(/^\/usb-bridge/, "") || "/",
      },
    },
  },
});
