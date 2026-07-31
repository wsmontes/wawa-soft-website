import MiniSearch, { type SearchResult } from "minisearch";
import { INDEX_BASE_URL, fetchCatalogManifest } from "./feed-catalog";

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
 *
 * The parsed index is cached in IndexedDB keyed by the manifest's `revision`
 * stamp (the manifest has no `gen` field, but `revision` is bumped on every
 * catalog regeneration, i.e. it is the generation stamp). On repeat visits
 * the small manifest is re-fetched to revalidate the cache, so the ~16MB
 * index download — and its re-parse — is skipped entirely when unchanged.
 */
export async function fetchCatalogIndex(
  onSize?: (bytes: number | null) => void,
): Promise<CatalogIndex> {
  // Revalidate against the tiny manifest first: its `revision` stamp tells
  // us whether the cached index is still current.
  let revision: number | null = null;
  try {
    revision = (await fetchCatalogManifest()).revision;
  } catch {
    // Manifest unavailable (offline, CDN hiccup) — fall through to the
    // cache, then to the full download.
  }

  if (revision !== null) {
    const cached = await readCachedIndex();
    if (cached && cached.revision === revision) return cached.data;
  }

  const response = await fetch(CATALOG_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog index: ${response.status}`);
  }
  const length = response.headers.get("Content-Length");
  onSize?.(length ? parseInt(length, 10) : null);
  const data = (await response.json()) as CatalogIndex;
  if (
    revision !== null &&
    data.v === INDEX_SCHEMA_VERSION &&
    Array.isArray(data.docs) &&
    data.docs.length > 0
  ) {
    writeCachedIndex({ gen: data.gen, revision, data });
  }
  return data;
}

// --- IndexedDB cache ------------------------------------------------------
// The catalog index is a ~16MB JSON payload. Serving repeat visits from
// IndexedDB (revalidated against the manifest's revision stamp) avoids
// re-downloading and re-parsing it on every page load.

const INDEX_SCHEMA_VERSION = 1;
const CACHE_DB_NAME = "feedmine-catalog";
const CACHE_STORE = "cache";
const CACHE_KEY = "catalog-index";

interface CacheEntry {
  gen: string;
  revision: number;
  data: CatalogIndex;
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(CACHE_DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(CACHE_STORE)) {
        req.result.createObjectStore(CACHE_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function readCachedIndex(): Promise<CacheEntry | null> {
  return new Promise((resolve) => {
    openCacheDb()
      .then((db) => {
        const req = db
          .transaction(CACHE_STORE, "readonly")
          .objectStore(CACHE_STORE)
          .get(CACHE_KEY);
        req.onsuccess = () => {
          const entry = req.result as CacheEntry | undefined;
          const data = entry?.data;
          const usable =
            data &&
            data.v === INDEX_SCHEMA_VERSION &&
            Array.isArray(data.docs) &&
            data.docs.length > 0;
          resolve(usable ? entry : null);
        };
        req.onerror = () => resolve(null);
      })
      .catch(() => resolve(null));
  });
}

function writeCachedIndex(entry: CacheEntry): void {
  openCacheDb()
    .then((db) => {
      db.transaction(CACHE_STORE, "readwrite")
        .objectStore(CACHE_STORE)
        .put(entry, CACHE_KEY);
    })
    .catch(() => {
      // Caching is best-effort — never fail catalog loading over it.
    });
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
 * Returns matching DocEntry objects with match terms for highlighting, plus
 * the pre-filter matched doc indices so callers can reuse a single search
 * for both the results and the facet counts.
 */
export interface SearchResult {
  docs: DocEntry[];
  matchTerms: Map<number, string[]>; // doc index → matched terms
  /** Doc indices matching the query, before filters. null when no query. */
  matchedIds: Set<number> | null;
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
    return { docs: filtered, matchTerms, matchedIds: null };
  }

  const results = engine.search(query, { prefix: true, fuzzy: 0.2 });
  const termsById = new Map<number, string[]>();
  for (const r of results) {
    const id = r.id as number;
    const terms = Object.keys(r.match ?? {});
    const existing = termsById.get(id) ?? [];
    termsById.set(id, [...existing, ...terms]);
  }
  const matchedIds = new Set(termsById.keys());

  const filtered = docs.filter((doc, i) => {
    if (!termsById.has(i)) return false;
    if (filters.topic && doc.tp !== filters.topic) return false;
    if (filters.subcategory && doc.sc !== filters.subcategory) return false;
    if (filters.country && doc._co !== filters.country) return false;
    if (filters.mediaKind && doc.m !== filters.mediaKind) return false;
    if (filters.language && doc.l.toUpperCase() !== filters.language.toUpperCase()) return false;
    if (filters.activity && doc.a !== filters.activity) return false;
    matchTerms.set(i, termsById.get(i)!);
    return true;
  });

  return { docs: filtered, matchTerms, matchedIds };
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
 * (excluding the facet being counted, so counts reflect what happens if you
 * add that filter).
 *
 * `matchedSet` carries the doc indices matching the active search query
 * (null when there is no query). Every count is intersected with it, so
 * facet counts reflect the docs the user is currently searching, not the
 * whole catalog. Callers pass the result of a single `searchAndFilter` call
 * here so facets never trigger a second search.
 *
 * The count is computed in a single chunked pass with yield points so a
 * 43k-doc recount never blocks the main thread for long.
 */
export async function facetCounts(
  docs: DocEntry[],
  filters: FilterState,
  matchedSet: Set<number> | null = null,
): Promise<FacetCounts> {
  const topicCounts = new Map<string, number>();
  const subCounts = new Map<string, number>(); // "topic sub" → count
  const countryCounts = new Map<string, number>();
  const mediaCounts = new Map<string, number>();
  const langCounts = new Map<string, number>();
  const activityCounts = new Map<string, number>();

  const CHUNK = 8000;
  for (let i = 0; i < docs.length; i += CHUNK) {
    const end = Math.min(i + CHUNK, docs.length);
    for (let j = i; j < end; j++) {
      const doc = docs[j];
      if (matchedSet && !matchedSet.has((doc as any)._idx as number)) continue;

      if (passesExcept(doc, filters, SKIP_TOPIC)) {
        topicCounts.set(doc.tp, (topicCounts.get(doc.tp) ?? 0) + 1);
        if (doc.sc) {
          const key = `${doc.tp} ${doc.sc}`;
          subCounts.set(key, (subCounts.get(key) ?? 0) + 1);
        }
      }
      if (passesExcept(doc, filters, SKIP_COUNTRY) && doc._co) {
        countryCounts.set(doc._co, (countryCounts.get(doc._co) ?? 0) + 1);
      }
      if (passesExcept(doc, filters, SKIP_MEDIA)) {
        mediaCounts.set(doc.m, (mediaCounts.get(doc.m) ?? 0) + 1);
      }
      const lang = doc.l.trim().toUpperCase();
      if (lang && passesExcept(doc, filters, SKIP_LANGUAGE)) {
        langCounts.set(lang, (langCounts.get(lang) ?? 0) + 1);
      }
      if (passesExcept(doc, filters, SKIP_ACTIVITY)) {
        activityCounts.set(doc.a, (activityCounts.get(doc.a) ?? 0) + 1);
      }
    }
    if (end < docs.length) {
      // Yield to the event loop so the UI stays responsive while typing.
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const sortByCount = (a: { k: string; c: number }, b: { k: string; c: number }) =>
    b.c - a.c || a.k.localeCompare(b.k);

  const topics = [...topicCounts.entries()]
    .map(([k, c]) => ({ k, c }))
    .sort(sortByCount);

  const subcategories = [...subCounts.entries()]
    .map(([key, c]) => {
      const sep = key.indexOf(" ");
      return { topic: key.slice(0, sep), k: key.slice(sep + 1), c };
    })
    .sort((a, b) => b.c - a.c || a.k.localeCompare(b.k));

  // No hard cap here: the UI slices to 15 for display and expands to the
  // full list on "Show all", so truncating would mislabel the total.
  const countries = [...countryCounts.entries()]
    .filter(([, c]) => c > 0)
    .map(([k, c]) => ({ k, c }))
    .sort(sortByCount);

  const mediaKindLabels: Record<string, string> = { text: "Text", audio: "Audio", video: "Video" };
  const mediaKinds = [...mediaCounts.entries()]
    .map(([k, c]) => ({ k, c, label: mediaKindLabels[k] ?? k }))
    .sort((a, b) => b.c - a.c || a.k.localeCompare(b.k));

  // Languages are computed from the current scope (query + other filters)
  // rather than a global top-20 list, so any language in scope is reachable
  // in the facet, no matter how rare it is globally.
  const languages = [...langCounts.entries()]
    .map(([k, c]) => ({ k, c }))
    .sort(sortByCount);

  const activityLabels: Record<string, string> = {
    prolific: "Prolific",
    active: "Active",
    quiet: "Quiet",
    dormant: "Dormant",
  };
  const activities = [...activityCounts.entries()]
    .map(([k, c]) => ({ k, c, label: activityLabels[k] ?? k }))
    .sort((a, b) => b.c - a.c || a.k.localeCompare(b.k));

  return { topics, subcategories, countries, mediaKinds, languages, activities };
}

export interface FacetCounts {
  topics: Array<{ k: string; c: number }>;
  /** Subcategory counts keyed by parent topic, intersected like `topics`. */
  subcategories: Array<{ topic: string; k: string; c: number }>;
  countries: Array<{ k: string; c: number }>;
  mediaKinds: Array<{ k: string; c: number; label: string }>;
  languages: Array<{ k: string; c: number }>;
  activities: Array<{ k: string; c: number; label: string }>;
}

/** Facet filters skipped when counting a facet — each facet is counted with
 *  itself excluded so the number reflects what happens if you add it. */
const SKIP_TOPIC = { topic: true, subcategory: true };
const SKIP_COUNTRY = { country: true };
const SKIP_MEDIA = { mediaKind: true };
const SKIP_LANGUAGE = { language: true };
const SKIP_ACTIVITY = { activity: true };

function passesExcept(doc: DocEntry, f: FilterState, skip: FacetSkip): boolean {
  if (!skip.topic && f.topic && doc.tp !== f.topic) return false;
  if (!skip.subcategory && f.subcategory && doc.sc !== f.subcategory) return false;
  if (!skip.country && f.country && doc._co !== f.country) return false;
  if (!skip.mediaKind && f.mediaKind && doc.m !== f.mediaKind) return false;
  if (!skip.language && f.language && doc.l.toUpperCase() !== f.language.toUpperCase()) return false;
  if (!skip.activity && f.activity && doc.a !== f.activity) return false;
  return true;
}

interface FacetSkip {
  topic?: boolean;
  subcategory?: boolean;
  country?: boolean;
  mediaKind?: boolean;
  language?: boolean;
  activity?: boolean;
}
