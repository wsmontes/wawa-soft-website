# FeedMine Catalog Browser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/catalog` page that lets users browse, search, and filter all 43,583 FeedMine feeds through a hierarchical directory inspired by the old Netscape directory concept.

**Architecture:** A Python script in feed-repository builds a single `catalog/catalog-index.json` from all OPML files — a tree of topics→subcategories, a flat country list, and a docs array with short-key entries. The Astro page at `/catalog` fetches this file once, parses the tree for sidebar navigation, and indexes docs into MiniSearch for instant full-text search. All navigation, search, and filtering is client-side.

**Tech Stack:** Python 3 (index generation), Astro 6.x + Tailwind CSS 4 (page), MiniSearch (client-side search), GitHub Pages (static hosting).

## Global Constraints

- All user-facing text in English.
- Design tokens: bg `#fafaf8`, text `#1a1a1a`, borders `#e8e4dd`/`#d4d0c8`, muted `#6b6b6b`/`#5c5c5c`/`#8a8a8a`, accent hover `#f5f3ef`, system font stack, font-mono labels.
- Layout within `max-w-[800px]` (Layout component).
- Page NOT in main nav — reachable from the datasheet breadcrumb and `/feedmine` page.
- 100% client-side after initial index fetch. Works offline after first load.
- Feed cards link to `/feed?sourceId=<hash>`.

---

### Task 1 (feed-repository): Build Catalog Index Script

**Files:**
- Create: `scripts/build_catalog_index.py`

**Goal:** Python script that processes all OPML files and generates `catalog/catalog-index.json` with tree, countries, docs, and stats.

- [ ] **Step 1: Create `scripts/build_catalog_index.py`**

The script follows the same conventions as `scripts/build_feed_index.py` (same ROOT, same fail(), same manifest-reading pattern).

```python
#!/usr/bin/env python3
"""Build a single catalog index JSON from OPML files for the
FeedMine Catalog Browser (/catalog page on wawasoft.net).

Generates catalog/catalog-index.json with:
- tree: topics → subcategories with feed counts and doc indices
- countries: flat list of countries with feed counts and doc indices
- docs: flat array of compact feed entries (short keys)
- stats: source/ country/ topic counts
"""

from __future__ import annotations

import json
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CATALOG_DIR = ROOT / "catalog"

# ---------------------------------------------------------------------------
# Short-key doc entry — maps 1:1 from OPML attributes (see spec)
# ---------------------------------------------------------------------------
# DocEntry fields: t=title, d=description, kw=keywords, s=sourceId,
#   l=language, m=mediaKind, n=nature, a=activity, tp=topic, sc=subcategory


def fail(message: str) -> None:
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    manifest_data = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    if manifest_data.get("schemaVersion") != 1:
        fail("manifest schemaVersion must be 1")

    entries = manifest_data.get("files")
    if not isinstance(entries, list):
        fail("manifest files must be a list")

    # Data structures
    docs: list[dict] = []
    topic_subcats: dict[str, dict[str, list[int]]] = defaultdict(
        lambda: defaultdict(list)
    )
    country_feeds: dict[str, list[int]] = defaultdict(list)

    doc_index = 0

    for entry in entries:
        repo_path = entry.get("path", "")
        if not repo_path:
            continue

        opml_path = ROOT / repo_path
        if not opml_path.is_file():
            print(f"warning: missing file {repo_path}, skipping", file=sys.stderr)
            continue

        try:
            tree = ET.parse(opml_path)
        except ET.ParseError as exc:
            print(f"warning: skipping invalid XML {repo_path}: {exc}", file=sys.stderr)
            continue

        # Determine if this is a country OPML
        is_country = repo_path.startswith("Feeds/90_countries/")
        country_name = None
        if is_country:
            parts = Path(repo_path).parts
            if len(parts) >= 3:
                country_name = parts[2].replace("_", " ").title()

        for outline in tree.getroot().iter("outline"):
            attrs = outline.attrib
            if "feedmineSourceId" not in attrs:
                continue

            title = attrs.get("title") or attrs.get("text", "")
            if not title:
                continue

            doc = {
                "t": title,
                "d": attrs.get("description", ""),
                "kw": attrs.get("category", ""),
                "s": attrs["feedmineSourceId"],
                "l": attrs.get("language", ""),
                "m": attrs.get("feedmineMediaKind", ""),
                "n": attrs.get("feedmineNature", ""),
                "a": attrs.get("feedmineActivity", ""),
                "tp": attrs.get("feedmineTopic", ""),
                "sc": attrs.get("feedmineSubcategory", ""),
            }

            docs.append(doc)

            topic = doc["tp"]
            subcat = doc["sc"]

            if is_country and country_name:
                country_feeds[country_name].append(doc_index)
            else:
                topic_subcats[topic][subcat].append(doc_index)

            doc_index += 1

    # Build tree
    tree_list = []
    for topic_name in sorted(topic_subcats.keys()):
        subcats = topic_subcats[topic_name]
        sub_list = []
        total = 0
        for sc_name in sorted(subcats.keys()):
            indices = subcats[sc_name]
            total += len(indices)
            sub_list.append({"k": sc_name, "c": len(indices), "docs": indices})
        tree_list.append({"k": topic_name, "c": total, "sub": sub_list})

    # Build countries list
    countries_list = []
    for cname in sorted(country_feeds.keys()):
        indices = country_feeds[cname]
        countries_list.append({"k": cname, "c": len(indices), "docs": indices})

    # Stats
    stats = {
        "sources": doc_index,
        "countries": len(countries_list),
        "topics": len(tree_list),
    }

    # Assemble index
    index = {
        "v": 1,
        "gen": manifest_data.get("generatedAt", ""),
        "stats": stats,
        "tree": tree_list,
        "docs": docs,
        "countries": countries_list,
    }

    # Write
    CATALOG_DIR.mkdir(exist_ok=True)
    output_path = CATALOG_DIR / "catalog-index.json"
    output_path.write_text(
        json.dumps(index, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )

    file_size_mb = output_path.stat().st_size / (1024 * 1024)
    print(
        f"Catalog index: {doc_index:,} feeds, {len(tree_list)} topics, "
        f"{len(countries_list)} countries → {output_path} ({file_size_mb:.1f} MB)"
    )


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Run the script and verify output**

```bash
cd /path/to/feed-repository
python3 scripts/build_catalog_index.py
```

Expected output:
```
Catalog index: 43,583 feeds, 17 topics, 94 countries → catalog/catalog-index.json (X.X MB)
```

- [ ] **Step 3: Verify JSON structure**

```bash
python3 -c "
import json
with open('catalog/catalog-index.json') as f:
    data = json.load(f)
print('Keys:', list(data.keys()))
print('Stats:', data['stats'])
print('Topics:', [t['k'] for t in data['tree']])
print('First topic:', data['tree'][0]['k'], '-', data['tree'][0]['c'], 'feeds')
print('First subcat:', data['tree'][0]['sub'][0]['k'], '-', len(data['tree'][0]['sub'][0]['docs']), 'docs')
print('Countries:', len(data['countries']))
print('First country:', data['countries'][0]['k'], '-', data['countries'][0]['c'], 'feeds')
print('Docs:', len(data['docs']))
print('First doc:', data['docs'][0])
# Verify doc indices reference valid docs
max_idx = max(data['tree'][0]['sub'][0]['docs'])
print(f'Max doc index in first subcat: {max_idx} (valid: {max_idx < len(data[\"docs\"])})')
"
```

- [ ] **Step 4: Commit**

```bash
git add scripts/build_catalog_index.py catalog/
git commit -m "feat: add catalog index generator and initial index"
```

---

### Task 2 (feed-repository): Update CI Workflow

**Files:**
- Modify: `.github/workflows/validate.yml`

- [ ] **Step 1: Add catalog index build step to the `build-index` job**

Add after the existing `python3 scripts/build_feed_index.py` line:

```yaml
      - run: python3 scripts/build_catalog_index.py
```

- [ ] **Step 2: Ensure `catalog/` is included in the commit step**

The existing `git add index/` should also include `catalog/`. Update the `git add` line:

```yaml
          git add index/ catalog/
```

- [ ] **Step 3: Verify the workflow YAML is valid**

Run the workflow locally or push to main and check Actions tab.

- [ ] **Step 4: Commit and push to main**

```bash
git add .github/workflows/validate.yml
git commit -m "ci: add catalog index generation to workflow"
git push origin main
```

---

### Task 3 (wawa-soft-website): Install MiniSearch

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install minisearch**

```bash
npm install minisearch
```

- [ ] **Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "deps: add minisearch for catalog search"
```

---

### Task 4 (wawa-soft-website): Catalog Index Module

**Files:**
- Create: `src/lib/catalog-index.ts`

**Interfaces:**
- Consumes: `INDEX_BASE_URL` from `src/lib/feed-catalog.ts`
- Produces: `CatalogIndex`, `TreeNode`, `SubcategoryNode`, `CountryNode`, `DocEntry` types; `fetchCatalogIndex()`, `createSearchEngine()`, `filterDocs()`, `searchDocs()`

- [ ] **Step 1: Create `src/lib/catalog-index.ts` with types**

```typescript
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
```

- [ ] **Step 2: Add fetch function**

```typescript
import { INDEX_BASE_URL } from "./feed-catalog";

const CATALOG_INDEX_URL = `${INDEX_BASE_URL}/catalog/catalog-index.json`;

export async function fetchCatalogIndex(): Promise<CatalogIndex> {
  const response = await fetch(CATALOG_INDEX_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch catalog index: ${response.status}`);
  }
  return response.json() as Promise<CatalogIndex>;
}
```

- [ ] **Step 3: Add MiniSearch setup**

```typescript
import MiniSearch, { type SearchResult } from "minisearch";

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
```

- [ ] **Step 4: Add filter helper**

```typescript
export interface FilterState {
  mediaKind: string;   // "" means all
  language: string;    // "" means all
  activity: string;    // "" means all
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
    .map((r) => engine.documentStore.get(r.id as number)!)
    .filter((doc) => {
      if (filters.mediaKind && doc.m !== filters.mediaKind) return false;
      if (filters.language && doc.l !== filters.language) return false;
      if (filters.activity && doc.a !== filters.activity) return false;
      return true;
    });
}
```

- [ ] **Step 5: Add common language list helper**

```typescript
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
```

- [ ] **Step 6: Verify module compiles**

```bash
npx tsc --noEmit src/lib/catalog-index.ts
```

- [ ] **Step 7: Commit**

```bash
git add src/lib/catalog-index.ts
git commit -m "feat: add catalog index module with types, fetch, search, and filters"
```

---

### Task 5 (wawa-soft-website): Catalog Page

**Files:**
- Create: `src/pages/catalog.astro`

**Interfaces:**
- Consumes: `fetchCatalogIndex`, `createSearchEngine`, `filterDocs`, `searchDocs`, `commonLanguages`, types from `src/lib/catalog-index.ts`
- Consumes: Layout from `src/layouts/Layout.astro`

This is the main page. It has a loading state, a two-column browse layout, search, and filter dropdowns.

- [ ] **Step 1: Create the skeleton shell with Layout, loading state, and empty layout**

```astro
---
import Layout from "../layouts/Layout.astro";
---

<Layout
  title="FeedMine Catalog"
  description="Browse, search, and explore 43,000+ feeds in the FeedMine catalog."
>
  <div id="catalog-root" class="pb-16 pt-8">
    <!-- Breadcrumb -->
    <a
      href="/feedmine"
      class="inline-flex items-center gap-1 text-[13px] text-[#6b6b6b] transition-colors hover:text-[#1a1a1a]"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      FeedMine Catalog
    </a>

    <!-- Loading state -->
    <div id="catalog-loading" class="mt-8">
      <div class="animate-pulse space-y-3">
        <div class="h-5 w-48 rounded bg-[#e8e4dd]"></div>
        <div class="h-4 w-64 rounded bg-[#e8e4dd]"></div>
      </div>
      <p class="mt-4 text-[14px] text-[#8a8a8a]" id="catalog-loading-text">
        Loading catalog...
      </p>
    </div>

    <!-- Error state -->
    <div id="catalog-error" class="mt-16 hidden text-center">
      <p class="text-[15px] text-[#5c5c5c]">
        Could not load the catalog. It may be temporarily unavailable.
      </p>
      <button
        id="catalog-retry"
        class="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[#d4d0c8] px-4 py-2 text-[14px] font-medium text-[#1a1a1a] transition-colors hover:border-[#b0aba0] hover:bg-[#f5f3ef]"
      >
        Retry
      </button>
    </div>

    <!-- Main content (hidden until loaded) -->
    <div id="catalog-main" class="mt-8 hidden">
      <!-- Search bar -->
      <div class="relative mb-4">
        <input
          id="catalog-search"
          type="text"
          placeholder="Search sources, topics, keywords..."
          class="w-full rounded-lg border border-[#d4d0c8] bg-white px-4 py-2.5 text-[14px] text-[#1a1a1a] placeholder:text-[#8a8a8a] outline-none transition-colors focus:border-[#b0aba0]"
        />
      </div>

      <!-- Filters -->
      <div class="mb-6 flex flex-wrap gap-3">
        <select id="filter-media" class="rounded-md border border-[#d4d0c8] bg-white px-3 py-1.5 text-[13px] text-[#1a1a1a] outline-none">
          <option value="">All media</option>
          <option value="text">Text</option>
          <option value="audio">Audio</option>
          <option value="video">Video</option>
        </select>
        <select id="filter-language" class="rounded-md border border-[#d4d0c8] bg-white px-3 py-1.5 text-[13px] text-[#1a1a1a] outline-none">
          <option value="">All languages</option>
        </select>
        <select id="filter-activity" class="rounded-md border border-[#d4d0c8] bg-white px-3 py-1.5 text-[13px] text-[#1a1a1a] outline-none">
          <option value="">All activity</option>
          <option value="prolific">Prolific</option>
          <option value="active">Active</option>
          <option value="quiet">Quiet</option>
          <option value="dormant">Dormant</option>
        </select>
      </div>

      <!-- Two-column layout -->
      <div class="flex flex-col gap-8 sm:flex-row">
        <!-- Sidebar -->
        <aside id="catalog-sidebar" class="w-full shrink-0 sm:w-[220px]">
          <!-- Browse by Topic -->
          <div>
            <h2 class="text-[13px] font-medium text-[#1a1a1a]">Browse by Topic</h2>
            <nav id="topic-nav" class="mt-2 space-y-0.5"></nav>
          </div>
          <!-- Browse by Country -->
          <div class="mt-6">
            <h2 class="text-[13px] font-medium text-[#1a1a1a]">Browse by Country</h2>
            <nav id="country-nav" class="mt-2 max-h-[300px] space-y-0.5 overflow-y-auto"></nav>
          </div>
        </aside>

        <!-- Results -->
        <main id="catalog-results" class="min-w-0 flex-1">
          <div id="results-header" class="mb-4"></div>
          <div id="results-list" class="space-y-2"></div>
          <p id="results-count" class="mt-4 text-[13px] text-[#8a8a8a]"></p>
        </main>
      </div>
    </div>
  </div>
</Layout>
```

- [ ] **Step 2: Add the client-side script block**

A single `<script>` block (no `is:inline`) that imports from `../lib/catalog-index.ts`.

**State variables:**

```typescript
let engine: MiniSearch<IndexedDoc>;
let docs: DocEntry[];
let currentView: "topic" | "subcategory" | "country" | "search" | "none" = "none";
let currentIndices: number[] = [];
let currentBreadcrumb = "";
```

**Init function:**

```typescript
async function init() {
  showLoading("Loading catalog...");
  const index = await fetchCatalogIndex();
  docs = index.docs;
  engine = createSearchEngine(docs);
  renderTopicNav(index.tree);
  renderCountryNav(index.countries);
  populateLanguageFilter(commonLanguages(docs));
  showMain();
  updateResultsCount();
}
```

**Sidebar — renderTopicNav(topicList):**
- For each topic: `<a>` with topic name + count badge
- Click handler: sets `currentView = "topic"`, stores topic indices from all subcategories, renders subcategory cards in results area, updates breadcrumb to topic name

**Sidebar — renderCountryNav(countriesList):**
- For each country: `<a>` with country name + count badge
- Click handler: sets `currentView = "country"`, stores country doc indices, renders feed cards

**Results — renderSubcategories(topic):**
- Clears results area header, sets breadcrumb
- For each subcategory: renders a card with name + count
- Click handler: sets `currentView = "subcategory"`, sets `currentIndices = sub.docs`, calls `renderFeedCards(sub.docs)`, updates breadcrumb

**Results — renderFeedCards(indices, filters):**
- Calls `filterDocs(indices, docs, getFilters())` → filtered doc list
- If empty, shows "No sources match these filters."
- For each doc: renders compact feed card:
  ```html
  <a href="/feed?sourceId=${escapeAttr(doc.s)}" class="block rounded-lg border border-[#e8e4dd] p-3 transition-colors hover:border-[#d4d0c8]">
    <span>${escapeHtml(doc.t)}</span>
    <span>${mediaBadge(doc.m)} ${escapeHtml(doc.l)} · ${escapeHtml(doc.sc)}</span>
    <span>${escapeHtml(doc.d).substring(0, 140)}</span>
  </a>
  ```
- Updates "Showing N sources in [context]" footer

**Search handler (input event on #catalog-search):**
```typescript
function handleSearch() {
  const query = (document.getElementById("catalog-search") as HTMLInputElement).value;
  if (!query.trim()) {
    restoreBrowseView();
    return;
  }
  currentView = "search";
  const results = searchDocs(query, engine, getFilters());
  if (results.length === 0) {
    renderEmpty("No sources match your search.");
  } else {
    renderSearchResults(results);
  }
  breadcrumb(`Catalog > Search: "${escapeHtml(query)}"`);
  updateResultsCount(results.length, `results for "${escapeHtml(query)}"`);
}
```

**Filter handler (change event on any filter select):**
```typescript
function handleFilterChange() {
  if (currentView === "search") {
    handleSearch(); // re-run search with new filters
  } else if (currentView === "subcategory" || currentView === "country") {
    renderFeedCards(currentIndices, getFilters());
  } else if (currentView === "topic") {
    renderSubcategories(currentTopic);
  }
}
```

**getFilters() helper:**
```typescript
function getFilters(): FilterState {
  return {
    mediaKind: (document.getElementById("filter-media") as HTMLSelectElement).value,
    language: (document.getElementById("filter-language") as HTMLSelectElement).value,
    activity: (document.getElementById("filter-activity") as HTMLSelectElement).value,
  };
}
```

**Event wiring (at end of init):**
```typescript
document.getElementById("catalog-search")!.addEventListener("input", debounce(handleSearch, 200));
document.getElementById("filter-media")!.addEventListener("change", handleFilterChange);
document.getElementById("filter-language")!.addEventListener("change", handleFilterChange);
document.getElementById("filter-activity")!.addEventListener("change", handleFilterChange);
document.getElementById("catalog-retry")!.addEventListener("click", init);
```

**escapeHtml / escapeAttr helpers** — same as `src/pages/feed.astro` pattern (copy verbatim).

**mediaBadge(m: string)** — returns inline SVG icon (same as `iconLink/iconFeed` from feed.astro, adapted for audio (speaker), video (play), text (document)).

- [ ] **Step 3: Verify the build**

```bash
npm run build
```

Expected: no errors, `dist/catalog/index.html` exists.

- [ ] **Step 4: Commit**

```bash
git add src/pages/catalog.astro
git commit -m "feat: add feedmine catalog browser page"
```

---

### Task 6: Integration Test

- [ ] **Step 1: Start dev server and test catalog load**

```bash
npm run dev
```

Open `http://localhost:4321/catalog` — verify loading state transitions to catalog main. Verify topics render in sidebar with counts. Verify countries render in sidebar.

- [ ] **Step 2: Test drill-down**

Click "Technology & Science" → right panel shows subcategories with counts.
Click "Earth & Life Sciences" → right panel shows feed cards.
Click a feed card → navigates to `/feed?sourceId=...` with datasheet.

- [ ] **Step 3: Test search**

Type "nature" in search bar → results appear with Nature journal near top.
Clear search → drill-down view restored.
Search with filter (e.g., media=Audio) → results filtered.

- [ ] **Step 4: Test filters**

Browse to a subcategory → apply media filter → cards filtered.
Clear filter → all cards restored.
Search + filter combination works.

- [ ] **Step 5: Test edge cases**

- Empty search query → no results panel changes
- Filter yields zero results → "No sources match these filters."
- Network error (block `raw.githubusercontent.com`) → error state with retry
- Mobile viewport → sidebar collapses to toggle

- [ ] **Step 6: Commit any fixes**

---

### Task 7: Build and Deploy Verification

- [ ] **Step 1: Production build**

```bash
npm run build
```

Expected: `dist/catalog/index.html` exists, no warnings.

- [ ] **Step 2: Verify dist output**

Check that `dist/catalog/index.html` contains:
- Layout shell (header, footer, meta)
- Loading skeleton HTML
- Bundled JS (includes minisearch + catalog-index logic)

- [ ] **Step 3: Merge to main and push**

```bash
git checkout main
git merge <feature-branch>
git push origin main
```

- [ ] **Step 4: Verify live at `wawasoft.net/catalog`**
