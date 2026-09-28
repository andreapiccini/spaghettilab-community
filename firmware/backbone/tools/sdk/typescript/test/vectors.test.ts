import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  bytesToHex,
  hexToBytes,
  decodeOne,
} from "../src/codec.js";
import { encodeCatalogPage, decodeCatalogPage } from "../src/catalog.js";
import {
  decodeConfig,
  decodeIntegerValue,
  decodeRecordEventPayload,
  decodeRequest,
  decodeResponse,
  encodeConfig,
  encodeInt64Value,
  encodeRecordEventPayload,
  encodeRequest,
  encodeResponse,
  encodeUint64Value,
  emptySpaghettiConfig,
  integerJsonRoundTrip,
  parseIntegerJson,
} from "../src/config-codec.js";

const vectorsDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../../contracts/protocol-v1/vectors/v1",
);

type Vector = {
  name: string;
  cbor_hex: string;
  normalized: Record<string, unknown>;
};

function loadVectors(): Vector[] {
  return readdirSync(vectorsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(readFileSync(path.join(vectorsDir, f), "utf8")) as Vector);
}

describe("shared golden vectors", () => {
  it("loads every vector file", () => {
    const vectors = loadVectors();
    expect(vectors.map((v) => v.name).sort()).toEqual([
      "catalog",
      "config",
      "error",
      "int64min",
      "record",
      "request",
      "response",
      "uint64max",
    ]);
  });

  it("round-trips request / response / error envelopes", () => {
    for (const name of ["request", "response", "error"]) {
      const vector = loadVectors().find((v) => v.name === name)!;
      const bytes = hexToBytes(vector.cbor_hex);
      if (name === "request") {
        const decoded = decodeRequest(bytes);
        expect(decoded.correlationId).toBe(vector.normalized.correlation_id);
        expect(decoded.operation).toBe(vector.normalized.operation);
        expect(bytesToHex(encodeRequest(decoded))).toBe(vector.cbor_hex);
      } else {
        const decoded = decodeResponse(bytes);
        expect(decoded.correlationId).toBe(vector.normalized.correlation_id);
        expect(decoded.statusCode).toBe(vector.normalized.status);
        expect(bytesToHex(encodeResponse(decoded.correlationId, decoded.status, decoded.payload))).toBe(
          vector.cbor_hex,
        );
      }
    }
  });

  it("round-trips config / catalog / record", () => {
    const config = loadVectors().find((v) => v.name === "config")!;
    const decodedConfig = decodeConfig(hexToBytes(config.cbor_hex));
    expect(decodedConfig.modules[0]?.type).toBe("ina219");
    expect(bytesToHex(encodeConfig(decodedConfig))).toBe(config.cbor_hex);

    const catalog = loadVectors().find((v) => v.name === "catalog")!;
    const page = decodeCatalogPage(hexToBytes(catalog.cbor_hex));
    expect(page.fingerprint).toBe(catalog.normalized.fingerprint);
    expect(bytesToHex(encodeCatalogPage(page))).toBe(catalog.cbor_hex);

    const record = loadVectors().find((v) => v.name === "record")!;
    const decodedRecord = decodeRecordEventPayload(hexToBytes(record.cbor_hex));
    expect(decodedRecord.schemaId).toBe("spaghetti.ina219.sample");
    expect(bytesToHex(encodeRecordEventPayload(decodedRecord))).toBe(record.cbor_hex);
  });

  it("preserves extreme integers without parseFloat", () => {
    const int64 = loadVectors().find((v) => v.name === "int64min")!;
    const uint64 = loadVectors().find((v) => v.name === "uint64max")!;
    const min = decodeIntegerValue(hexToBytes(int64.cbor_hex));
    const max = decodeIntegerValue(hexToBytes(uint64.cbor_hex));
    expect(min).toBe(-9223372036854775808n);
    expect(max).toBe(18446744073709551615n);
    expect(integerJsonRoundTrip(min)).toBe(String(min));
    expect(integerJsonRoundTrip(max)).toBe(String(max));
    expect(parseIntegerJson(String(min))).toBe(min);
    expect(parseIntegerJson(String(max))).toBe(max);
    expect(bytesToHex(encodeInt64Value(min))).toBe(int64.cbor_hex);
    expect(bytesToHex(encodeUint64Value(max))).toBe(uint64.cbor_hex);
    expect(() => parseIntegerJson(Number.MAX_VALUE)).toThrow();
    void emptySpaghettiConfig;
    void decodeOne;
  });
});
