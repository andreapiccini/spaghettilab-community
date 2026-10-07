import {
  parsePhysicalCatalog,
  type PhysicalCatalogEntry,
} from "./backbone-physical.js";

export type HubFile = {
  readonly id: string;
  readonly name: string;
  readonly contentType: string;
  readonly sha256: string;
  readonly size: number;
};
export type HubContent = {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly coverId?: string;
  readonly coverPreset?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
};
export type HubModule = HubContent &
  PhysicalCatalogEntry & { readonly available: boolean };
export type HubPackage = HubContent & {
  readonly kind:
    "firmware" | "capability-pack" | "device-profile" | "project" | "extension";
  readonly version: string;
  readonly target: string;
  readonly channel: string;
  readonly file?: HubFile;
  readonly manifest?: Record<string, unknown>;
};
export type HubPost = HubContent & {
  readonly body: string;
  readonly category: string;
  readonly featured: boolean;
  readonly tags: readonly string[];
};
export type HubPoll = HubContent & {
  readonly options: readonly string[];
  readonly counts: readonly number[];
  readonly closesAt: string;
};
export type HubContest = HubContent & {
  readonly rules: string;
  readonly prize: string;
  readonly closesAt: string;
  readonly submissionCount: number;
  readonly awards: readonly {
    readonly id: string;
    readonly prize: string;
    readonly winner: string;
    readonly projectTitle: string;
  }[];
};
export type HubSnapshot = {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly updatedAt: string;
  readonly modules: readonly HubModule[];
  readonly packages: readonly HubPackage[];
  readonly posts: readonly HubPost[];
  readonly polls: readonly HubPoll[];
  readonly contests: readonly HubContest[];
};
export type HubUser = {
  readonly id: string;
  readonly displayName: string;
  readonly username: string;
};
export type HubAccount = {
  readonly votes: readonly { readonly pollId: string; readonly option: number }[];
  readonly submissions: readonly {
    readonly id: string;
    readonly contestId: string;
    readonly title: string;
  }[];
};
export const DEFAULT_HUB_URL = "http://127.0.0.1:8790";
export function normalizeHubUrl(raw: string): string {
  const url = new URL(raw.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error("Indica un indirizzo HTTP o HTTPS valido");
  if (
    url.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
  )
    throw new Error("Per un server esterno usa HTTPS");
  return url.href.replace(/\/$/, "");
}
export function hubCatalog(
  snapshot: HubSnapshot | null,
): readonly PhysicalCatalogEntry[] {
  if (!snapshot) return [];
  return parsePhysicalCatalog(
    JSON.stringify(snapshot.modules.map((entry) => ({ ...entry, name: entry.title }))),
  );
}
export function parseHubSnapshot(value: unknown): HubSnapshot {
  if (!value || typeof value !== "object")
    throw new Error("Risposta del server non valida");
  const snapshot = value as HubSnapshot;
  if (
    snapshot.schemaVersion !== 1 ||
    !Number.isSafeInteger(snapshot.revision) ||
    !["modules", "packages", "posts", "polls", "contests"].every((key) =>
      Array.isArray((value as Record<string, unknown>)[key]),
    )
  )
    throw new Error("Versione del server non supportata");
  for (const item of [
    ...snapshot.modules,
    ...snapshot.packages,
    ...snapshot.posts,
    ...snapshot.polls,
    ...snapshot.contests,
  ])
    if (
      typeof item.id !== "string" ||
      typeof item.title !== "string" ||
      typeof item.description !== "string" ||
      (item.coverId && !/^[a-f0-9]{64}$/.test(item.coverId))
    )
      throw new Error("Contenuto del server non valido");
  hubCatalog(snapshot);
  const validDate = (date: unknown) =>
    typeof date === "string" && Number.isFinite(Date.parse(date));
  if (!validDate(snapshot.updatedAt))
    throw new Error("Data di sincronizzazione non valida");
  for (const post of snapshot.posts) {
    if (
      typeof post.body !== "string" ||
      !Array.isArray(post.tags) ||
      post.tags.some((tag) => typeof tag !== "string")
    )
      throw new Error("Articolo non valido");
  }
  for (const entry of snapshot.packages) {
    if (
      ![
        "firmware",
        "capability-pack",
        "device-profile",
        "project",
        "extension",
      ].includes(entry.kind) ||
      typeof entry.version !== "string" ||
      typeof entry.target !== "string"
    )
      throw new Error("Pacchetto non valido");
    if (
      entry.file &&
      (!/^[a-f0-9]{64}$/.test(entry.file.id) ||
        entry.file.sha256 !== entry.file.id ||
        !Number.isSafeInteger(entry.file.size) ||
        entry.file.size < 1 ||
        entry.file.size > 64 * 1024 * 1024 ||
        typeof entry.file.name !== "string")
    )
      throw new Error("File del pacchetto non valido");
  }
  for (const contest of snapshot.contests) {
    if (
      !validDate(contest.closesAt) ||
      typeof contest.rules !== "string" ||
      typeof contest.prize !== "string" ||
      !Number.isSafeInteger(contest.submissionCount) ||
      contest.submissionCount < 0 ||
      !Array.isArray(contest.awards) ||
      contest.awards.some(
        (award) =>
          !award ||
          typeof award.id !== "string" ||
          typeof award.winner !== "string" ||
          typeof award.projectTitle !== "string" ||
          typeof award.prize !== "string",
      )
    )
      throw new Error("Contest non valido");
  }
  for (const poll of snapshot.polls)
    if (
      !validDate(poll.closesAt) ||
      !Array.isArray(poll.options) ||
      poll.options.length < 2 ||
      poll.options.some((option) => typeof option !== "string") ||
      !Array.isArray(poll.counts) ||
      poll.options.length !== poll.counts.length ||
      poll.counts.some((count) => !Number.isInteger(count) || count < 0)
    )
      throw new Error("Votazione non valida");
  return snapshot;
}
export function readHubSetting(): string {
  try {
    return normalizeHubUrl(
      localStorage.getItem("spaghettilab:hub.url") ?? DEFAULT_HUB_URL,
    );
  } catch {
    return DEFAULT_HUB_URL;
  }
}
export function coverUrl(base: string, entry: HubContent): string | undefined {
  return entry.coverId
    ? `${base}/api/v1/files/${entry.coverId}`
    : entry.coverPreset === "sense-dial"
      ? `${base}/cover.svg`
      : undefined;
}
export async function downloadHubFile(base: string, file: HubFile): Promise<void> {
  if (
    !/^[a-f0-9]{64}$/.test(file.id) ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    file.size > 64 * 1024 * 1024 ||
    file.size < 1
  )
    throw new Error("File non valido");
  const response = await fetch(`${base}/api/v1/files/${file.id}`, {
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error("Il file non è più disponibile");
  const bytes = await response.arrayBuffer();
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  if (bytes.byteLength !== file.size || digest !== file.sha256)
    throw new Error("Il file scaricato non corrisponde al contenuto pubblicato");
  saveDownload(new Blob([bytes]), file.name);
}
export function saveDownload(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
}
