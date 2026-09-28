import type { SpaghettiClient } from "./client.js";
import { emptySpaghettiConfig } from "./config-codec.js";
import { ProtocolConflictError, ProtocolError } from "./errors.js";
import type {
  ApplyResult,
  ModuleConfig,
  RuleConfig,
  ScheduleConfig,
  SpaghettiConfig,
} from "./types.js";

export interface ConfigFragment {
  ownerId: string;
  modules?: ModuleConfig[];
  schedules?: ScheduleConfig[];
  rules?: RuleConfig[];
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function sameContent(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

function sortByKey<T extends { key: number }>(items: T[]): T[] {
  return [...items].sort((x, y) => x.key - y.key);
}

function sortSchedules(items: ScheduleConfig[]): ScheduleConfig[] {
  return [...items].sort(
    (a, b) => a.sourceKey - b.sourceKey || a.periodMs - b.periodMs,
  );
}

/**
 * Host-only Config merge coordinator for Node-RED.
 * `ownerId` never enters firmware Config.
 */
export class ConfigCoordinator {
  private readonly fragments = new Map<string, ConfigFragment>();

  constructor(private readonly client: SpaghettiClient) {}

  setFragment(fragment: ConfigFragment): void {
    if (!fragment.ownerId) {
      throw new ProtocolError("invalid_argument", "ownerId is required");
    }
    this.fragments.set(fragment.ownerId, {
      ownerId: fragment.ownerId,
      modules: fragment.modules ? [...fragment.modules] : undefined,
      schedules: fragment.schedules ? [...fragment.schedules] : undefined,
      rules: fragment.rules ? [...fragment.rules] : undefined,
    });
  }

  removeFragment(ownerId: string): void {
    this.fragments.delete(ownerId);
  }

  async preview(): Promise<SpaghettiConfig> {
    const snapshot = await this.client.getConfig();
    return this.merge(snapshot.config);
  }

  async synchronize(): Promise<ApplyResult> {
    if (this.fragments.size === 0) {
      throw new ProtocolError(
        "invalid_argument",
        "refusing to apply empty Config during partial deploy",
      );
    }

    const first = await this.client.getConfig();
    const merged = this.merge(first.config);
    if (
      merged.modules.length === 0 &&
      merged.schedules.length === 0 &&
      merged.rules.length === 0 &&
      merged.blocks.length === 0
    ) {
      throw new ProtocolError(
        "invalid_argument",
        "refusing to apply empty Config during partial deploy",
      );
    }

    await this.client.validateConfig(merged);
    try {
      return await this.client.applyConfig(merged, first.revision.generation);
    } catch (error) {
      if (!(error instanceof ProtocolConflictError)) {
        throw error;
      }
      // One conflict recovery: re-read, merge, validate, new correlation via applyConfig.
      const second = await this.client.getConfig();
      const mergedAgain = this.merge(second.config);
      await this.client.validateConfig(mergedAgain);
      try {
        return await this.client.applyConfig(mergedAgain, second.revision.generation);
      } catch (secondError) {
        if (secondError instanceof ProtocolConflictError) {
          throw secondError;
        }
        throw secondError;
      }
    }
  }

  private merge(base: SpaghettiConfig): SpaghettiConfig {
    const owners = [...this.fragments.keys()].sort();
    const ownedModuleKeys = new Set<number>();
    const ownedRuleKeys = new Set<number>();
    const ownedScheduleKeys = new Set<string>();

    const claimedModules = new Map<number, { ownerId: string; module: ModuleConfig }>();
    const claimedRules = new Map<number, { ownerId: string; rule: RuleConfig }>();
    const claimedSchedules = new Map<
      string,
      { ownerId: string; schedule: ScheduleConfig }
    >();

    for (const ownerId of owners) {
      const fragment = this.fragments.get(ownerId)!;
      for (const module of fragment.modules ?? []) {
        const existing = claimedModules.get(module.key);
        if (existing && !sameContent(existing.module, module)) {
          throw new ProtocolError(
            "conflict",
            `module key ${module.key} claimed by ${existing.ownerId} and ${ownerId} with different content`,
          );
        }
        claimedModules.set(module.key, { ownerId, module });
        ownedModuleKeys.add(module.key);
      }
      for (const rule of fragment.rules ?? []) {
        const existing = claimedRules.get(rule.key);
        if (existing && !sameContent(existing.rule, rule)) {
          throw new ProtocolError(
            "conflict",
            `rule key ${rule.key} claimed by ${existing.ownerId} and ${ownerId} with different content`,
          );
        }
        claimedRules.set(rule.key, { ownerId, rule });
        ownedRuleKeys.add(rule.key);
      }
      for (const schedule of fragment.schedules ?? []) {
        const scheduleKey = `${schedule.sourceKey}:${schedule.periodMs}`;
        const existing = claimedSchedules.get(scheduleKey);
        if (existing && !sameContent(existing.schedule, schedule)) {
          throw new ProtocolError(
            "conflict",
            `schedule ${scheduleKey} claimed by ${existing.ownerId} and ${ownerId} with different content`,
          );
        }
        claimedSchedules.set(scheduleKey, { ownerId, schedule });
        ownedScheduleKeys.add(scheduleKey);
      }
    }

    const modules = [
      ...base.modules.filter((m) => !ownedModuleKeys.has(m.key)),
      ...[...claimedModules.values()].map((v) => v.module),
    ];
    const rules = [
      ...base.rules.filter((r) => !ownedRuleKeys.has(r.key)),
      ...[...claimedRules.values()].map((v) => v.rule),
    ];
    const schedules = [
      ...base.schedules.filter(
        (s) => !ownedScheduleKeys.has(`${s.sourceKey}:${s.periodMs}`),
      ),
      ...[...claimedSchedules.values()].map((v) => v.schedule),
    ];

    return {
      ...emptySpaghettiConfig(),
      ...base,
      modules: sortByKey(modules),
      rules: sortByKey(rules),
      schedules: sortSchedules(schedules),
      blocks: sortByKey(base.blocks),
      edges: [...base.edges].sort(
        (a, b) =>
          a.sourceKey - b.sourceKey ||
          a.targetKey - b.targetKey ||
          a.sourcePortOrField - b.sourcePortOrField,
      ),
    };
  }
}
