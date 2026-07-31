import MiniSearch, { type SearchResult } from "minisearch";
import { INDEX_BASE_URL } from "./feed-catalog";

const CATALOG_INDEX_URL = `${INDEX_BASE_URL}/catalog/catalog-index.json`;

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

export interface FilterState {
  mediaKind: string; // "" means all
  language: string; // "" means all
  activity: string; // "" means all
}

export function filterDocs(
  docIndices: number[],
  docs: DocEntry[],
  filters: FilterState,
): DocEntry[] {
  return docIndices
    .map((i) => docs[i])
    .filter((doc) => {
      if (filters.mediaKind && doc.m !== filters.mediaKind) return false;
      if (filters.language && doc.l !== filters.language) return false;
      if (filters.activity && doc.a !== filters.activity) return false;
      return true;
    });
}

export function searchDocs(
  query: string,
  engine: MiniSearch<IndexedDoc>,
  filters: FilterState,
): IndexedDoc[] {
  let results: SearchResult[];

  if (query.trim()) {
    results = engine.search(query, { prefix: true, fuzzy: 0.2 });
  } else {
    return [];
  }

  return results
    .map((r) => engine.getStoredFields(r.id as number) as unknown as IndexedDoc)
    .filter((doc) => {
      if (filters.mediaKind && doc.m !== filters.mediaKind) return false;
      if (filters.language && doc.l !== filters.language) return false;
      if (filters.activity && doc.a !== filters.activity) return false;
      return true;
    });
}

export function commonLanguages(docs: DocEntry[]): string[] {
  const counts = new Map<string, number>();
  for (const doc of docs) {
    counts.set(doc.l, (counts.get(doc.l) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([lang]) => lang);
}
