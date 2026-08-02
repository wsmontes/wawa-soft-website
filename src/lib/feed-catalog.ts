/** Matches the index shard structure served by feed-repository. */
export interface FeedRecord {
  title: string;
  description: string;
  xmlUrl: string;
  htmlUrl: string | null;
  /** OPML `type` attribute ("rss", "atom", …). */
  type?: string;
  language: string;
  category: string;
  feedmineSourceId: string;
  feedmineTopic: string;
  feedmineSubcategory: string;
  feedmineNature: string;
  feedmineActivity: string;
  feedmineArticlesFetched: string;
  feedmineDefaultEnabled: string;
  feedmineMediaKind: string;
  feedmineLatestItemAt: string;
  _opmlPath: string;
}

/** Matches the top-level manifest.json from feed-repository. */
export interface CatalogManifest {
  fileCount: number;
  sourceCount: number;
  files: Array<{ bytes: number; path: string; sha256: string }>;
  generatedAt: string;
  revision: number;
  schemaVersion: number;
}

/** Base URL for raw feed-repository content. */
export const INDEX_BASE_URL =
  "https://raw.githubusercontent.com/wawasoft/feed-repository/main";

const SOURCE_ID_RE = /^[a-f0-9]{64}$/;

export function isValidSourceId(value: string): boolean {
  return SOURCE_ID_RE.test(value);
}

export function getShardKey(sourceId: string): string {
  return sourceId.substring(0, 2).toLowerCase();
}

/**
 * Fetches the index shard for `sourceId` and returns the matching
 * FeedRecord, or null if not found.
 */
export async function fetchFeedRecord(
  sourceId: string,
): Promise<FeedRecord | null> {
  const shard = getShardKey(sourceId);
  const url = `${INDEX_BASE_URL}/index/${shard}.json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch index shard: ${response.status}`);
  }

  const index: Record<string, FeedRecord> = await response.json();
  return index[sourceId] ?? null;
}

/**
 * Fetches the manifest.json from feed-repository for global catalog stats.
 */
export async function fetchCatalogManifest(): Promise<CatalogManifest> {
  const url = `${INDEX_BASE_URL}/manifest.json`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog manifest: ${response.status}`);
  }

  return response.json() as Promise<CatalogManifest>;
}

const MEDIA_KIND_LABELS: Record<string, string> = {
  text: "Text",
  audio: "Audio",
  video: "Video",
};

const ACTIVITY_LABELS: Record<string, string> = {
  prolific: "Prolific",
  active: "Active",
  quiet: "Quiet",
  dormant: "Dormant",
};

const NATURE_LABELS: Record<string, string> = {
  periodic: "Periodic",
  evergreen: "Evergreen",
  "current-sensitive": "Current-sensitive",
  personal: "Personal",
};

export function mediaKindLabel(kind: string): string {
  return MEDIA_KIND_LABELS[kind] ?? kind;
}

export function activityLabel(activity: string): string {
  return ACTIVITY_LABELS[activity] ?? activity;
}

export function natureLabel(nature: string): string {
  return NATURE_LABELS[nature] ?? nature;
}

export function formatLabel(format: string): string {
  const labels: Record<string, string> = {
    rss: "RSS",
    atom: "Atom",
    jsonfeed: "JSON Feed",
  };
  return labels[format?.toLowerCase()] ?? format;
}

export function formatEnabled(value: string): string {
  return value === "true" ? "Enabled" : "Disabled";
}

export function formatTimestamp(ts: string): string {
  // OPML timestamps look like "2026-07-15 13:30:54-07"
  // Convert to ISO-like with full tz offset: "2026-07-15T13:30:54-07:00"
  try {
    const iso = ts.replace(" ", "T");
    const fixed = iso.replace(/([+-]\d{2})$/, "$1:00");
    const date = new Date(fixed);
    if (isNaN(date.getTime())) return ts;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    });
  } catch {
    return ts;
  }
}

export function formatDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (isNaN(date.getTime())) return iso;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
