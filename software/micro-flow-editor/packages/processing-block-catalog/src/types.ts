/**
 * Authoring catalog for the Device Processing Graph. `GET_CATALOG` still only
 * lists Module Drivers, so this package is the host-side source of Block/Rule/
 * schedule/event operations until the wire grows those descriptors. Firmware
 * `type_id` values remain the runtime authority: a shipped entry's `typeId` must
 * match a `SPAGHETTI_BLOCK_DRIVER_DEFINE` / rule driver, never an invented UI name.
 *
 * AppBlocks Library blocks are mapped here with named inspector `fields`.
 * Planned `ab.*` typeIds are authoring-only until Config/firmware maps them.
 * Vendor-only hardware is omitted, not faked as Core drivers.
 */

import type { BlockPort } from "./ports.js";

export type ProcessingCatalogCategoryId =
  | "system"
  | "trigger"
  | "variables"
  | "logic"
  | "math"
  | "filter"
  | "time"
  | "io"
  | "strings"
  | "display"
  | "sound"
  | "storage"
  | "serial"
  | "network"
  | "cloud"
  | "modbus";

export type ProcessingRuntime =
  | "core-block"
  | "core-rule"
  | "core-schedule"
  | "core-event"
  | "core-admin"
  | "authoring"
  | "node-red"
  | "feature"
  | "out-of-scope";

export type ProcessingAvailability = "shipped" | "pack" | "planned" | "unavailable";

export type ProcessingNodeKind = "schedule" | "event-source" | "block" | "rule";

/**
 * Authoring axis for the Processing Graph palette:
 * - `functionality` — azioni / logica (es. Digital Toggle, Schedule)
 * - `bay` — endpoint legati a moduli hardware reali (es. LED, Relay)
 */
export type ProcessingBlockFamily = "functionality" | "bay";

/**
 * Hardware I/O side for bay blocks on the canvas:
 * - `input` — a sinistra del canvas (letture / ingressi)
 * - `output` — a destra, fuori dallo Schedule (attuatori)
 * - `both` — mostra entrambe le metà (stesso `bayFamilyId`)
 * - `either` — l’utente sceglie ingresso o uscita in palette
 */
export type BayIoRole = "input" | "output" | "both" | "either";

export type CatalogFieldType = "text" | "textarea" | "number" | "checkbox" | "select" | "color";

export type CatalogField = {
  readonly id: string;
  readonly label: string;
  readonly type: CatalogFieldType;
  readonly placeholder?: string;
  readonly options?: readonly { readonly value: string; readonly label: string }[];
  readonly default?: string | number | boolean;
  /** Show this field only when another property matches (Inspector). */
  readonly when?: {
    readonly field: string;
    readonly equals?: string;
    readonly in?: readonly string[];
  };
};

export type { BlockPort, PortType, SignalDomain, SignalRole } from "./ports.js";

export type ProcessingCatalogEntry = {
  readonly id: string;
  readonly label: string;
  readonly subtitle: string;
  readonly category: ProcessingCatalogCategoryId;
  readonly runtime: ProcessingRuntime;
  readonly availability: ProcessingAvailability;
  readonly nodeKind?: ProcessingNodeKind;
  /** AppBlocks `data-testid="li-node_<id>-blocklist"` id, when this row maps one. */
  readonly appblocksId?: string;
  /** Firmware `spaghetti_block_config.type_id` or `spaghetti_rule_config.type_id`. */
  readonly typeId?: string;
  readonly packId?: string;
  readonly notes: string;
  /**
   * Named inspector fields (AppBlocks-style). When present, the Inspector
   * shows these instead of raw firmware field_id rows. Values live in
   * `properties` and are authoring-only until config/firmware maps them.
   */
  readonly fields?: readonly CatalogField[];
  /**
   * Typed inputs. Empty array = no inputs (source / entry).
   * `undefined` = not yet declared (connection stays permissive).
   */
  readonly inputs?: readonly BlockPort[];
  /**
   * Typed outputs. Empty array = sink (e.g. LED).
   * `undefined` = not yet declared (connection stays permissive).
   */
  readonly outputs?: readonly BlockPort[];
  /** Event-source/schedule: false = no Module picker (e.g. On Boot). Default true. */
  readonly needsModule?: boolean;
  /** Palette family. Default `functionality`. */
  readonly family?: ProcessingBlockFamily;
  /** When `family === "bay"`: hardware I/O side policy. */
  readonly bayIo?: BayIoRole;
  /**
   * Shared id linking ingresso/uscita halves of the same hardware bay
   * (used when `bayIo` is `both` or `either`).
   */
  readonly bayFamilyId?: string;
};

export type ProcessingCatalogCategory = {
  readonly id: ProcessingCatalogCategoryId;
  readonly label: string;
  readonly color: string;
};
