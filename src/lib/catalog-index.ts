import MiniSearch, { type SearchResult } from "minisearch";
import { INDEX_BASE_URL } from "./feed-catalog";

const CATALOG_INDEX_URL = `${INDEX_BASE_URL}/catalog/catalog-index.json`;
const PER_PAGE = 50;

/** Matches catalog/catalog-index.json schema v1. */
export interface CatalogIndex {
  v: number;
  gen: string;
  stats: { sources: number; countries: number; topics: number };
  tree: TreeNode[];
  docs: DocEntry[];
  countries: CountryNode[];
}

export interface TreeNode {
  k: string;
  c: number;
  sub: SubcategoryNode[];
}

export interface SubcategoryNode {
  k: string;
  c: number;
  docs: number[];
}

export interface CountryNode {
  k: string;
  c: number;
  docs: number[];
}

export interface DocEntry {
  t: string;
  d: string;
  kw: string;
  s: string;
  l: string;
  m: string;
  n: string;
  a: string;
  tp: string;
  sc: string;
  _co?: string; // country name — enriched client-side from buildDocCountryMap
}

/**
 * Fetches the full catalog index. `onSize` fires as soon as the response
 * headers arrive, with the payload size in bytes (Content-Length) or null
 * if the server did not report it — used to show download size during load.
 */
export async function fetchCatalogIndex(
  onSize?: (bytes: number | null) => void,
): Promise<CatalogIndex> {
  const response = await fetch(CATALOG_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog index: ${response.status}`);
  }
  const length = response.headers.get("Content-Length");
  onSize?.(length ? parseInt(length, 10) : null);
  return response.json() as Promise<CatalogIndex>;
}

export interface IndexedDoc {
  id: number;
  t: string;
  d: string;
  kw: string;
  s: string;
  l: string;
  m: string;
  n: string;
  a: string;
  tp: string;
  sc: string;
}

/**
 * Builds the search engine over all docs. Indexing 43k+ docs is done in
 * chunks with `await` yield points between them so the loading UI keeps
 * animating instead of blocking the main thread for seconds.
 *
 * `onProgress(done, total)` fires after each chunk. `_co` (country name)
 * must be set on the docs before calling this so country names are
 * searchable (facet values are indexed: country, language, activity, media).
 */
export async function createSearchEngine(
  docs: DocEntry[],
  onProgress?: (done: number, total: number) => void,
): Promise<MiniSearch<IndexedDoc>> {
  const indexedDocs: IndexedDoc[] = docs.map((doc, i) => ({
    id: i,
    ...doc,
  }));

  const miniSearch = new MiniSearch<IndexedDoc>({
    // Facet values are searchable too, so "portugal", "video", or "en"
    // match what the facets show.
    fields: ["t", "d", "kw", "tp", "sc", "_co", "l", "a", "m"],
    storeFields: ["t", "d", "s", "l", "m", "n", "a", "tp", "sc"],
    searchOptions: {
      boost: { t: 3, kw: 2, tp: 1.5, sc: 1.5, d: 1, _co: 1.5, l: 1, a: 1, m: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });

  const CHUNK_SIZE = 4000;
  for (let i = 0; i < indexedDocs.length; i += CHUNK_SIZE) {
    miniSearch.addAll(indexedDocs.slice(i, i + CHUNK_SIZE));
    const done = Math.min(i + CHUNK_SIZE, indexedDocs.length);
    onProgress?.(done, indexedDocs.length);
    if (done < indexedDocs.length) {
      // Yield to the event loop so the loading spinner keeps animating.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  return miniSearch;
}

/** All active filters — empty string means "no filter". */
export interface FilterState {
  topic: string;
  subcategory: string;
  country: string;
  mediaKind: string;
  language: string;
  activity: string;
}

export function emptyFilters(): FilterState {
  return { topic: "", subcategory: "", country: "", mediaKind: "", language: "", activity: "" };
}

/** Build a map from doc array index → country name using the CountryNode data. */
export function buildDocCountryMap(countries: CountryNode[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const country of countries) {
    for (const idx of country.docs) {
      map.set(idx, country.k);
    }
  }
  return map;
}

/**
 * Apply all active filters to the full doc array.
 * docCountryMap: doc index → country name for country filtering.
 */
export function applyFilters(
  docs: DocEntry[],
  filters: FilterState,
): DocEntry[] {
  return docs.filter((doc) => {
    if (filters.topic && doc.tp !== filters.topic) return false;
    if (filters.subcategory && doc.sc !== filters.subcategory) return false;
    if (filters.country && doc._co !== filters.country) return false;
    if (filters.mediaKind && doc.m !== filters.mediaKind) return false;
    if (filters.language && doc.l.toUpperCase() !== filters.language.toUpperCase()) return false;
    if (filters.activity && doc.a !== filters.activity) return false;
    return true;
  });
}

/**
 * Full-text search intersecting with active filters.
 * Returns matching DocEntry objects with match terms for highlighting.
 */
export interface SearchResult {
  docs: DocEntry[];
  matchTerms: Map<number, string[]>; // doc index → matched terms
}

export function searchAndFilter(
  query: string,
  engine: MiniSearch<IndexedDoc>,
  docs: DocEntry[],
  filters: FilterState,
): SearchResult {
  const matchTerms = new Map<number, string[]>();

  if (!query.trim()) {
    const filtered = applyFilters(docs, filters);
    return { docs: filtered, matchTerms };
  }

  const results = engine.search(query, { prefix: true, fuzzy: 0.2 });
  const matchedIds = new Map<number, string[]>();
  for (const r of results) {
    const id = r.id as number;
    const terms = Object.keys(r.match ?? {});
    const existing = matchedIds.get(id) ?? [];
    matchedIds.set(id, [...existing, ...terms]);
  }

  const filtered = docs.filter((doc, i) => {
    if (!matchedIds.has(i)) return false;
    if (filters.topic && doc.tp !== filters.topic) return false;
    if (filters.subcategory && doc.sc !== filters.subcategory) return false;
    if (filters.country && doc._co !== filters.country) return false;
    if (filters.mediaKind && doc.m !== filters.mediaKind) return false;
    if (filters.language && doc.l.toUpperCase() !== filters.language.toUpperCase()) return false;
    if (filters.activity && doc.a !== filters.activity) return false;
    matchTerms.set(i, matchedIds.get(i)!);
    return true;
  });

  return { docs: filtered, matchTerms };
}

/** Highlight matched terms in text by wrapping them in <mark> tags. */
export function highlightMatches(text: string, terms: string[]): string {
  if (!terms.length) return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const escaped = terms
    .filter((t) => t.length > 0)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!escaped.length) return text.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const regex = new RegExp(`(${escaped.join("|")})`, "gi");
  return text
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(regex, "<mark class=\"bg-[#fef3c7] text-[#1a1a1a] rounded-sm\">$1</mark>");
}

/** Paginate results. Returns the slice and total count. */
export function paginate(
  docs: DocEntry[],
  page: number,
  perPage: number = PER_PAGE,
): { items: DocEntry[]; total: number; pages: number; page: number } {
  const total = docs.length;
  const pages = Math.max(1, Math.ceil(total / perPage));
  const clampedPage = Math.max(1, Math.min(page, pages));
  const start = (clampedPage - 1) * perPage;
  return {
    items: docs.slice(start, start + perPage),
    total,
    pages,
    page: clampedPage,
  };
}

/**
 * Count how many docs match each facet value given the CURRENT filters
 * (excluding the facet being counted, so counts reflect what happens if you add that filter).
 *
 * When `query` is non-empty and `engine` is provided, every facet count is
 * intersected with the search result set, so facet counts reflect the docs
 * the user is currently searching, not the whole catalog.
 */
export function facetCounts(
  docs: DocEntry[],
  filters: FilterState,
  query = "",
  engine?: MiniSearch<IndexedDoc>,
): {
  topics: Array<{ k: string; c: number }>;
  countries: Array<{ k: string; c: number }>;
  mediaKinds: Array<{ k: string; c: number; label: string }>;
  languages: Array<{ k: string; c: number }>;
  activities: Array<{ k: string; c: number; label: string }>;
} {
  // Doc indices matching the active search query (unfiltered). Null = no query.
  let matchedSet: Set<number> | null = null;
  if (query.trim() && engine) {
    matchedSet = new Set(engine.search(query.trim()).map((r) => r.id as number));
  }
  const inScope = (doc: DocEntry): boolean =>
    !matchedSet || matchedSet.has((doc as any)._idx as number);

  const baseFilters = { ...filters };

  // Topics
  baseFilters.topic = "";
  baseFilters.subcategory = "";
  const topicCounts = new Map<string, number>();
  for (const doc of applyFilters(docs, baseFilters)) {
    if (!inScope(doc)) continue;
    topicCounts.set(doc.tp, (topicCounts.get(doc.tp) ?? 0) + 1);
  }
  const topics = [...topicCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, c]) => ({ k, c }));

  // Countries — uses _co field (enriched client-side from CountryNode data)
  baseFilters.topic = filters.topic;
  baseFilters.subcategory = filters.subcategory;
  baseFilters.country = "";
  const countryCounts = new Map<string, number>();
  for (const doc of applyFilters(docs, baseFilters)) {
    if (!inScope(doc)) continue;
    if (doc._co) countryCounts.set(doc._co, (countryCounts.get(doc._co) ?? 0) + 1);
  }
  // No hard cap here: the UI slices to 15 for display and expands to the full
  // list on "Show all", so truncating would mislabel the total.
  const countries = [...countryCounts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k, c]) => ({ k, c }));

  // Media kinds
  baseFilters.country = filters.country;
  baseFilters.mediaKind = "";
  const mediaKindLabels: Record<string, string> = { text: "Text", audio: "Audio", video: "Video" };
  const mediaCounts = new Map<string, number>();
  for (const doc of applyFilters(docs, baseFilters)) {
    if (!inScope(doc)) continue;
    mediaCounts.set(doc.m, (mediaCounts.get(doc.m) ?? 0) + 1);
  }
  const mediaKinds = [...mediaCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => ({ k, c, label: mediaKindLabels[k] ?? k }));

  // Languages
  const langLabels = commonLanguages(docs);
  baseFilters.mediaKind = filters.mediaKind;
  baseFilters.language = "";
  const langCounts = new Map<string, number>();
  for (const doc of applyFilters(docs, baseFilters)) {
    if (!inScope(doc)) continue;
    const lang = doc.l.trim().toUpperCase();
    if (!lang) continue;
    langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
  }
  const languages = langLabels
    .filter((l) => (langCounts.get(l) ?? 0) > 0)
    .map((k) => ({ k, c: langCounts.get(k) ?? 0 }));

  // Activities
  baseFilters.language = filters.language;
  baseFilters.activity = "";
  const activityLabels: Record<string, string> = {
    prolific: "Prolific",
    active: "Active",
    quiet: "Quiet",
    dormant: "Dormant",
  };
  const activityCounts = new Map<string, number>();
  for (const doc of applyFilters(docs, baseFilters)) {
    if (!inScope(doc)) continue;
    activityCounts.set(doc.a, (activityCounts.get(doc.a) ?? 0) + 1);
  }
  const activities = [...activityCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([k, c]) => ({ k, c, label: activityLabels[k] ?? k }));

  return { topics, countries, mediaKinds, languages, activities };
}

export function commonLanguages(docs: DocEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    const lang = doc.l.trim();
    if (!lang) continue;
    const key = lang.toUpperCase();
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 20)
    .map(([lang]) => lang);
}
