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

export async function fetchCatalogIndex(): Promise<CatalogIndex> {
  const response = await fetch(CATALOG_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog index: ${response.status}`);
  }
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

export function createSearchEngine(docs: DocEntry[]): MiniSearch<IndexedDoc> {
  const indexedDocs: IndexedDoc[] = docs.map((doc, i) => ({
    id: i,
    ...doc,
  }));

  const miniSearch = new MiniSearch<IndexedDoc>({
    fields: ["t", "d", "kw", "tp", "sc"],
    storeFields: ["t", "d", "s", "l", "m", "n", "a", "tp", "sc"],
    searchOptions: {
      boost: { t: 3, kw: 2, tp: 1.5, sc: 1.5, d: 1 },
      prefix: true,
      fuzzy: 0.2,
    },
  });

  miniSearch.addAll(indexedDocs);
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
 * Returns matching DocEntry objects (not IndexedDoc) for uniform rendering.
 */
export function searchAndFilter(
  query: string,
  engine: MiniSearch<IndexedDoc>,
  docs: DocEntry[],
  filters: FilterState,
): DocEntry[] {
  if (!query.trim()) {
    return applyFilters(docs, filters);
  }

  const results = engine.search(query, { prefix: true, fuzzy: 0.2 });
  const matchedIds = new Set(results.map((r) => r.id as number));

  return docs.filter((doc, i) => {
    if (!matchedIds.has(i)) return false;
    if (filters.topic && doc.tp !== filters.topic) return false;
    if (filters.subcategory && doc.sc !== filters.subcategory) return false;
    if (filters.country && doc._co !== filters.country) return false;
    if (filters.mediaKind && doc.m !== filters.mediaKind) return false;
    if (filters.language && doc.l.toUpperCase() !== filters.language.toUpperCase()) return false;
    if (filters.activity && doc.a !== filters.activity) return false;
    return true;
  });
}

/** Paginate results. Returns the slice and total count. */
export function paginate(
  docs: DocEntry[],
  page: number,
): { items: DocEntry[]; total: number; pages: number; page: number } {
  const total = docs.length;
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const clampedPage = Math.max(1, Math.min(page, pages));
  const start = (clampedPage - 1) * PER_PAGE;
  return {
    items: docs.slice(start, start + PER_PAGE),
    total,
    pages,
    page: clampedPage,
  };
}

/**
 * Count how many docs match each facet value given the CURRENT filters
 * (excluding the facet being counted, so counts reflect what happens if you add that filter).
 */
export function facetCounts(
  docs: DocEntry[],
  filters: FilterState,
): {
  topics: Array<{ k: string; c: number }>;
  countries: Array<{ k: string; c: number }>;
  mediaKinds: Array<{ k: string; c: number; label: string }>;
  languages: Array<{ k: string; c: number }>;
  activities: Array<{ k: string; c: number; label: string }>;
} {
  const baseFilters = { ...filters };

  // Topics
  baseFilters.topic = "";
  baseFilters.subcategory = "";
  const topicCounts = new Map<string, number>();
  for (const doc of applyFilters(docs, baseFilters)) {
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
    if (doc._co) countryCounts.set(doc._co, (countryCounts.get(doc._co) ?? 0) + 1);
  }
  const countries = [...countryCounts.entries()]
    .filter(([, c]) => c > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 50)
    .map(([k, c]) => ({ k, c }));

  // Media kinds
  baseFilters.country = filters.country;
  baseFilters.mediaKind = "";
  const mediaKindLabels: Record<string, string> = { text: "Text", audio: "Audio", video: "Video" };
  const mediaCounts = new Map<string, number>();
  for (const doc of applyFilters(docs, baseFilters)) {
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
