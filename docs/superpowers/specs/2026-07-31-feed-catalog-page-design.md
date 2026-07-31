# Feed Catalog Page — Design Spec

**Date:** 2026-07-31
**Status:** draft

## Overview

Add a `/feed/[sourceId]` route to the Wawasoft website that renders a datasheet for any feed cataloged in the [feed-repository](https://github.com/wawasoft/feed-repository). The page is a factual, neutral presence card — no scores, no judgments, no persuasive copy. It answers: "this feed exists in the FeedMine catalog."

The URL uses the `feedmineSourceId` hash (64-char hex) intentionally — these are shareable links sent directly to content creators, not SEO landing pages.

## Constraints

- **Static hosting**: GitHub Pages, no SSR at request time.
- **Scale**: ~43,000 feeds across 118 OPML files. Cannot enumerate all at build time.
- **Dynamic feel**: The page must feel instant — skeleton shell renders immediately, data arrives via client-side fetch.

## Architecture

### Data pipeline

```
feed-repository (GitHub)                wawa-soft-website (Astro)
────────────────────────                ─────────────────────────
Feeds/**/*.opml                        
    ↓                                   
GitHub Action (new step)                /feed/[sourceId].astro
  parse all OPMLs                          ↓
  extract feed outlines               client-side JS
  shard by sourceId prefix              extract sourceId from URL
  write /index/{XX}.json                fetch 1 shard JSON from raw GH
  commit to feed-repository             find feed record
    ↓                                   render datasheet
index/{XX}.json published via
raw.githubusercontent.com
```

### GitHub Action (feed-repository side)

Add a step to the existing publish workflow that:

1. Reads every OPML file listed in `manifest.json`.
2. Parses each `<outline>` element that has a `feedmineSourceId`.
3. Builds a flat map: `{ [sourceId]: FeedRecord }`.
4. Shards by first 2 hex chars of `sourceId` → 256 buckets.
5. Writes `index/{XX}.json` files.
6. Commits and pushes back to the repo.

**Shard size estimate**: 43,556 feeds ÷ 256 ≈ 170 feeds per shard. At ~0.5 KB per feed record, each shard is ~85 KB. Well within a single fast fetch.

### Astro page (`/feed/[sourceId]`)

One Astro page using a catch-all dynamic route:

- `src/pages/feed/[sourceId].astro`
- `getStaticPaths` returns an empty array (or a single example path) — we don't pre-render any feed page.
- Uses `export const prerender = false` to fall back to client-side rendering, OR uses Astro's `fallback` mechanism.
- **Alternative for pure SSG**: If Astro SSG can't handle `prerender = false` on GitHub Pages, use a static `/feed/[sourceId].html` generated via a catch-all + client-side redirect, or a single `/feed` page that reads the hash from `window.location`.

**Decision**: Use Astro's [on-demand rendering with a static adapter fallback](https://docs.astro.build/en/guides/on-demand-rendering/). If that proves incompatible with GitHub Pages, fall back to a single `/feed/index.html` that parses `window.location.pathname` in JS.

### FeedRecord schema (index shard)

```typescript
interface FeedRecord {
  // Standard OPML
  title: string;
  description: string;
  xmlUrl: string;
  htmlUrl: string | null;
  language: string;
  category: string;
  // FeedMine
  feedmineSourceId: string;
  feedmineTopic: string;
  feedmineSubcategory: string;
  feedmineNature: "periodic" | "evergreen" | "current-sensitive" | "personal";
  feedmineActivity: "prolific" | "active" | "quiet" | "dormant";
  feedmineArticlesFetched: string;
  feedmineDefaultEnabled: "true" | "false";
  feedmineMediaKind: "text" | "audio" | "video";
  feedmineLatestItemAt: string;
  // Source tracking
  _opmlPath: string;
}
```

## Page Layout

```
┌──────────────────────────────────────────────────────────────┐
│   ← FeedMine Catalog                                         │
│                                                              │
│   ┌─────────────────────────────────────────────────────────┐│
│   │  [título do feed]                                       ││
│   │  [description]                                          ││
│   │                                                         ││
│   │  🔗 htmlUrl                    📡 xmlUrl                ││
│   └─────────────────────────────────────────────────────────┘│
│                                                              │
│   ─── Identidade ─────────────────────────────────          │
│   Formato (type)  ·  Idioma (language)  ·  Mídia (mediaKind)│
│                                                              │
│   ─── Catalogação ──────────────────────────────            │
│   Tópico  ·  Subcategoria  ·  País (se aplicável)           │
│   Natureza  ·  Atividade  ·  Habilitado                      │
│   Keywords (category)                                        │
│                                                              │
│   ─── Atividade ──────────────────────────────────         │
│   Artigos catalogados (articlesFetched)                      │
│   Último item observado (latestItemAt)                       │
│   ──                                                        │
│   Dados da última curadoria do catálogo                     │
│                                                              │
│   ─── Técnico ───────────────────────────────────          │
│   Source ID (sourceId)                                       │
│   Arquivo OPML (_opmlPath)                                   │
│                                                              │
│   ─── Catálogo FeedMine ──────────────────────────         │
│   43.556 fontes · 101 países · 17 tópicos · 118 OPML         │
│   Catálogo atualizado em DD mmm AAAA (generatedAt)           │
│                                                              │
│   [Ver no GitHub ↗]              [Baixar OPML ↗]            │
│                                                              │
│   Dados da última curadoria do catálogo FeedMine.            │
│   Não refletem métricas em tempo real.                      │
└──────────────────────────────────────────────────────────────┘
```

## Visual Design

- Follow existing Wawasoft site design language: `#fafaf8` background, `#1a1a1a` text, `#e8e4dd` borders, font-mono for labels.
- Card grid layout with consistent border and padding.
- Skeleton state while data loads (pulsing placeholders).
- Error state: "Feed não encontrado no catálogo" with link to catalog.
- Data is shown in cards/labels, not prose. Purpose: datasheet, not article.

## States

| State | Behavior |
|---|---|
| **Loading** | Skeleton cards with pulse animation. Header visible immediately. |
| **Found** | All sections populate from FeedRecord. |
| **Not found** | "Source ID não encontrado no catálogo FeedMine" + link to feed-repository. |
| **Network error** | "Não foi possível carregar os dados do catálogo" + retry button. |
| **Invalid hash** | "Source ID inválido" — validate hex format before fetching. |

## Navigation

- The feed page is NOT in the main nav. It's a utility URL shared directly.
- Breadcrumb "← FeedMine Catalog" links back to `/feedmine`.
- Footer remains standard site footer.

## Files to Create / Modify

### wawa-soft-website

| File | Action |
|---|---|
| `src/pages/feed/[sourceId].astro` | Create — the datasheet page |
| `src/lib/feed-catalog.ts` | Create — fetch shard, lookup feed, type definitions |
| `src/data/site.ts` | Modify — optionally add feed catalog URL constant |

### feed-repository

| File | Action |
|---|---|
| `.github/workflows/publish.yml` (or equivalent) | Modify — add index generation step |
| `scripts/build_feed_index.py` (or `.js`) | Create — parse OPMLs, shard, write index |
| `index/` | Create — directory for shard JSONs (gitignored or committed) |

## Implementation Sequence

1. **feed-repository**: Build the index generator script and wire it into CI.
2. **feed-repository**: Run it once, verify shards are published on `raw.githubusercontent.com`.
3. **wawa-soft-website**: Create `src/lib/feed-catalog.ts` with types, fetch, and lookup logic.
4. **wawa-soft-website**: Create `src/pages/feed/[sourceId].astro` with layout, states, and visual design.
5. **Integration test**: Build and verify a real feed URL resolves correctly on the deployed site.

## Open Questions

- Does Astro SSG on GitHub Pages support `prerender = false`? If not, use a single `/feed` page with client-side path parsing.
- Should the index shards be committed to the feed-repository or served via GitHub Pages from that repo? Committed is simpler and works with raw.githubusercontent.com.
