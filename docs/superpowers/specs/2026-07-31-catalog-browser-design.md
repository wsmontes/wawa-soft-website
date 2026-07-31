# FeedMine Catalog Browser — Design Spec

**Date:** 2026-07-31
**Status:** draft

## Overview

Add a `/catalog` page to the Wawasoft website that provides a browsable, searchable directory of all 43,583 feeds in the FeedMine catalog. Inspired by the old Netscape directory concept — hierarchical drill-down by topic/country — combined with full-text search and combinable filters. The catalog is the landing page for exploring what FeedMine indexes, and each feed entry links to its datasheet (`/feed?sourceId=...`).

## Constraints

- **Static hosting**: GitHub Pages, no SSR.
- **Scale**: 43,583 feeds across 17 topics and 94 countries. Index must load in one fetch and work entirely client-side.
- **Performance**: First load ~1.5-2 MB gzipped (GitHub serves gzip transparently). Cached by browser. After cache, everything is instant.
- **Design**: Consistent with existing Wawasoft site (tokens, typography, layout).

## Architecture

### Data pipeline

```
feed-repository (GitHub)                wawa-soft-website (Astro)
────────────────────────                ─────────────────────────
build_catalog_index.py (new)            /catalog.astro
  reads all OPMLs                          ↓
  builds tree + docs array             fetch catalog-index.json
  writes catalog/catalog-index.json      ↓
  committed by CI                      parse tree → render sidebar nav
    ↓                                  index docs → MiniSearch
raw.githubusercontent.com               drill-down | search | filters
```

### Catalog Index Format (`catalog/catalog-index.json`)

```typescript
interface CatalogIndex {
  v: number;                     // schema version (1)
  gen: string;                   // ISO timestamp from manifest.generatedAt
  stats: {
    sources: number;
    countries: number;           // count of 90_countries subdirs
    topics: number;              // count of topic OPMLs (excludes countries)
  };
  tree: TreeNode[];
  docs: DocEntry[];
  countries: CountryNode[];      // separate flat list for Browse by Country
}

interface TreeNode {
  k: string;                     // topic name (e.g. "Technology & Science")
  c: number;                     // feed count in this topic
  sub: SubcategoryNode[];
}

interface SubcategoryNode {
  k: string;                     // subcategory name (e.g. "Earth & Life Sciences")
  c: number;                     // feed count
  docs: number[];                // indices into docs[]
}

interface CountryNode {
  k: string;                     // country name (e.g. "Brazil")
  c: number;                     // feed count
  docs: number[];                // indices into docs[]
}

interface DocEntry {
  t: string;                     // title
  d: string;                     // description
  kw: string;                    // keywords (from category attribute)
  s: string;                     // feedmineSourceId (64-char hex)
  l: string;                     // language (e.g. "en-US", "pt-BR")
  m: string;                     // mediaKind ("text" | "audio" | "video")
  n: string;                     // nature ("periodic" | "evergreen" | "current-sensitive" | "personal")
  a: string;                     // activity ("prolific" | "active" | "quiet" | "dormant")
  tp: string;                    // topic
  sc: string;                    // subcategory
}
```

Key design decisions:
- `docs` array uses short keys to minimize file size (~40% smaller than full field names).
- `tree` and `countries` reference docs by numeric index — no data duplication.
- Topic and country nodes carry feed counts for display.
- The file is gzip-compressed in transit by GitHub's CDN (~70% compression on JSON).

### Page: `/catalog.astro`

Single Astro page at `src/pages/catalog.astro`. Generates `/catalog/index.html`. No dynamic routes.

**Dependencies:**
- `minisearch` npm package (~6 KB gzipped) for client-side full-text search.
- `src/lib/feed-catalog.ts` — reuse `INDEX_BASE_URL` constant.
- `src/lib/catalog-index.ts` (new) — types, fetch, parse, MiniSearch setup.

## Interface Layout

```
┌──────────────────────────────────────────────────────────────┐
│   ← FeedMine Catalog                                         │
│                                                              │
│   ┌──────────────────────────────────────────────────────────┐
│   │  🔍 Search sources, topics, keywords...                   │
│   └──────────────────────────────────────────────────────────┘
│                                                              │
│   Filters:  [All media ▾]  [All languages ▾]  [All activity ▾]  │
│                                                              │
│   ┌──────────────────────┐ ┌────────────────────────────────┐│
│   │ Browse by Topic      │ │                                ││
│   │                      │ │  Technology & Science — 4,230  ││
│   │ Technology &         │ │  ──────────────────────────    ││
│   │   Science      4,230 │ │                                ││
│   │ News & Current       │ │  Acoustics & Sound       45    ││
│   │   Affairs      8,120 │ │  Earth & Life Sciences  189    ││
│   │ Arts & Culture    920│ │  Space & Astronomy       72    ││
│   │ Entertainment   2,100│ │  Computing & Internet    512    ││
│   │ ...                  │ │  ...                           ││
│   │                      │ │                                ││
│   │ Browse by Country    │ │  Results                      ││
│   │                      │ │  ───────                      ││
│   │ Brazil        1,331  │ │                                ││
│   │ Canada          890  │ │  ┌────────────────────────────┐││
│   │ USA           5,200  │ │  │ Nature                 📄 en│││
│   │ ...                  │ │  │ A leading international...  │││
│   │                      │ │  │ Earth & Life Sciences       │││
│   │                      │ │  └────────────────────────────┘││
│   └──────────────────────┘ └────────────────────────────────┘│
│                                                              │
│   Showing 189 sources in Earth & Life Sciences                │
└──────────────────────────────────────────────────────────────┘
```

## Behavior and States

### Loading
- On page load, fetch `catalog/catalog-index.json` from `raw.githubusercontent.com`.
- Show a subtle progress bar or skeleton while loading.
- Parse tree and render sidebar immediately as JSON streams.
- Initialize MiniSearch with docs array.

### Browse (default state after load)
- **Left sidebar:** Two sections — "Browse by Topic" (tree of 17 topics) and "Browse by Country" (flat list of 94 countries).
- **Right panel:** Empty with a prompt: "Select a topic or search to browse sources."
- **Click topic** → right panel shows topic header with count, lists subcategories as clickable cards with counts.
- **Click subcategory** → right panel shows feed cards for that subcategory.
- **Click country** → right panel shows feed cards for that country.
- **Click feed card** → navigates to `/feed?sourceId=...`.

### Search
- User types in search bar → MiniSearch runs with fuzzy matching.
- Results replace the right panel content.
- Results show feed cards ranked by relevance.
- Drill-down and search are exclusive: searching hides drill-down content, clearing search restores it.
- Search respects active filters.

### Filters
- Three dropdowns: Media kind (Text/Audio/Video/All), Language (common languages + All), Activity (Prolific/Active/Quiet/Dormant/All).
- Filters combine with both drill-down and search.
- Changing a filter immediately updates results.

### Breadcrumb
- Right panel top shows current context: `Catalog > Technology & Science > Earth & Life Sciences`.
- On search, breadcrumb shows: `Catalog > Search: "query"`.
- On country browse: `Catalog > Countries > Brazil`.

### Empty state
- If a combination of drill-down + filters yields zero results: "No sources match these filters."

### Error state
- If catalog-index.json fails to load: "Could not load catalog. Please try again." + Retry button.

### Result count
- Bottom of right panel: "Showing N sources in [context]" or "N results for [query]".

## Feed Card (compact)

Each feed in results is a compact card (not the full datasheet):

```
┌──────────────────────────────────────────────────────┐
│  Nature                    📄 en  ·  evergreen       │
│  A leading international weekly scientific journal   │
│  Earth & Life Sciences  ·  prolific                  │
└──────────────────────────────────────────────────────┘
```

- Title (clickable → datasheet)
- Description (max 2 lines, truncated)
- Badges: media icon, language, subcategory, activity
- No score, no link URLs — clean and scannable

## Visual Design

- Follow existing Wawasoft tokens: `#fafaf8` bg, `#1a1a1a` text, `#e8e4dd` borders, system font.
- Layout: two-column, left sidebar ~240px, right panel fills remaining space. Both within the site's `max-w-[800px]` wrapper. On mobile, sidebar collapses to a toggleable drawer.
- Sidebar: `text-[14px]`, active item highlighted with `text-[#1a1a1a] font-medium`, inactive items `text-[#5c5c5c]`. Count badges `text-[12px] text-[#8a8a8a]`.
- Feed cards: `rounded-lg border border-[#e8e4dd] p-3`, hover `border-[#d4d0c8]`.
- Search bar: rounded input with border, matching site style (similar to existing button borders).
- Filter dropdowns: `text-[13px]` select elements styled consistently.
- Badges: inline `text-[11px] font-mono text-[#6b6b6b]` separated by `·`.

## Files to Create / Modify

### feed-repository

| File | Action |
|---|---|
| `scripts/build_catalog_index.py` | Create — generates `catalog/catalog-index.json` |
| `.github/workflows/validate.yml` | Modify — add catalog index build step |
| `catalog/catalog-index.json` | Create — initial index (committed) |

### wawa-soft-website

| File | Action |
|---|---|
| `src/lib/catalog-index.ts` | Create — types, fetch, MiniSearch init, filter/search helpers |
| `src/pages/catalog.astro` | Create — page with layout, sidebar, search, results |
| `package.json` | Modify — add `minisearch` dependency |
| `src/data/site.ts` | Modify — optionally add catalog to navigation |

## Implementation Sequence

1. **feed-repository**: Create `build_catalog_index.py`, generate initial index, update CI.
2. **wawa-soft-website**: Install `minisearch`, create `src/lib/catalog-index.ts`.
3. **wawa-soft-website**: Create `src/pages/catalog.astro` with full layout.
4. **Integration test**: Verify drill-down, search, filters, and link to datasheet.
