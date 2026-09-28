import { spawn } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CORE_UTIL = path.resolve(
  __dirname,
  "../../../../../firmware/bringup/scripts/core_util.py",
);
const HOST = "127.0.0.1";
const PORT = Number(process.env.TAG_STUDIO_READER_PORT ?? 8787);
const PYTHON = process.env.TAG_STUDIO_PYTHON ?? "python3";
const CORE_UTIL = process.env.TAG_STUDIO_CORE_UTIL ?? DEFAULT_CORE_UTIL;

let busy = false;

function runCoreUtil(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Never use shell: true — argv only.
    const child = spawn(PYTHON, [CORE_UTIL, ...args], {
      shell: false,
      env: { ...process.env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

function lastJsonLine(stdout: string): Record<string, unknown> {
  const lines = stdout
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]!) as Record<string, unknown>;
    } catch {
      /* continue */
    }
  }
  throw new Error(`no NDJSON event in output: ${stdout.slice(0, 500)}`);
}

function send(res: import("node:http").ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
  });
  res.end(data);
}

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    send(res, 204, {});
    return;
  }
  if (req.method === "GET" && req.url === "/health") {
    send(res, 200, { ok: true, coreUtil: CORE_UTIL, busy });
    return;
  }
  if (req.method === "POST" && req.url === "/nfc") {
    if (busy) {
      send(res, 409, { error: "reader busy" });
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    let body: Record<string, unknown>;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
    } catch {
      send(res, 400, { error: "invalid JSON" });
      return;
    }

    const port = typeof body.port === "string" && body.port ? body.port : undefined;
    const cmd = String(body.cmd ?? "");
    const antenna = Number(body.antenna ?? 1);
    if (antenna !== 1 && antenna !== 2) {
      send(res, 400, { error: "antenna must be 1 or 2" });
      return;
    }

    const args: string[] = ["--json"];
    if (port) args.push("--port", port);

    try {
      busy = true;
      if (cmd === "scan") {
        args.push("nfc-scan", "--antenna", String(antenna));
      } else if (cmd === "read") {
        const page = Number(body.page ?? 0);
        const count = Number(body.count ?? 1);
        if (!Number.isInteger(page) || page < 0 || page > 63) throw new Error("invalid page");
        if (!Number.isInteger(count) || count < 1 || page + count > 64) throw new Error("invalid count");
        args.push("tag-read", "--antenna", String(antenna), "--page", String(page), "--count", String(count));
      } else if (cmd === "write") {
        const page = Number(body.page);
        const data = body.data as number[] | undefined;
        if (!Number.isInteger(page) || page < 0 || page > 63) throw new Error("invalid page");
        if (!Array.isArray(data) || data.length !== 4) throw new Error("data must be 4 bytes");
        const hex = data.map((b) => Number(b).toString(16).padStart(2, "0")).join(" ");
        args.push("tag-write", "--antenna", String(antenna), "--page", String(page), "--data", hex);
        if (body.force) args.push("--force");
      } else if (cmd === "info") {
        args.push("nfc-info");
      } else {
        send(res, 400, { error: `unknown cmd ${cmd}` });
        return;
      }

      const result = await runCoreUtil(args);
      if (result.code !== 0) {
        send(res, 502, { error: result.stderr || result.stdout || `exit ${result.code}` });
        return;
      }
      const event = lastJsonLine(result.stdout);
      send(res, 200, event);
    } catch (cause) {
      send(res, 500, { error: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      busy = false;
    }
    return;
  }
  send(res, 404, { error: "not found" });
});

server.listen(PORT, HOST, () => {
  console.log(`Tag Studio reader server on http://${HOST}:${PORT}`);
  console.log(`core_util: ${CORE_UTIL}`);
});
