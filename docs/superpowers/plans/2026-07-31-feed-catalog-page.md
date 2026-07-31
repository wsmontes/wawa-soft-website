# Feed Catalog Datasheet Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/feed` page to the Wawasoft website that renders a datasheet for any feed cataloged in the feed-repository, identified by `?sourceId=<64-char-hex-hash>`.

**Architecture:** Client-side rendered datasheet. The Astro page at `/feed` generates a static HTML shell with skeleton placeholders. On load, JS extracts `sourceId` from the query string, fetches a shard JSON from `raw.githubusercontent.com/wawasoft/feed-repository/main/index/{XX}.json`, finds the feed record, and populates the DOM. Zero server-side rendering — everything works on GitHub Pages static hosting.

**Tech Stack:** Astro 6.x, vanilla TypeScript (client-side), Tailwind CSS 4, GitHub Pages (static).

**URL format:** `wawasoft.net/feed?sourceId=<64-char-hex>` — query parameter, not path-based, because GitHub Pages cannot do server-side routing for dynamic path segments. The page is a single `/feed/index.html` served by Astro SSG.

## Global Constraints

- All user-facing text in English.
- Follow existing site design tokens: background `#fafaf8`, text `#1a1a1a`, borders `#e8e4dd`/`#d4d0c8`, muted text `#6b6b6b`/`#5c5c5c`, font-mono labels, system font stack.
- Layout max-width `800px`, same as rest of site.
- Page NOT in main navigation — it's a utility URL shared directly.
- Tone: neutral, factual datasheet. No scores, no judgments, no persuasive copy.
- Datasheet displays only fields present in the OPML feed record. No invented data.

---

### Task 0 (Prerequisite): Feed Repository Index Generation

This task lives in the `wawasoft/feed-repository` repository. It must be completed before the website datasheet page can function.

**Goal:** Generate sharded JSON index files so each feed can be looked up by its `feedmineSourceId`.

**Files to create in feed-repository:**
- `scripts/build_feed_index.py` — parses OPMLs, extracts feed records, shards output
- `.github/workflows/publish.yml` (modify) — add index generation step

**Index output structure:** `index/{XX}.json` where `XX` = first 2 hex chars of `feedmineSourceId`. Each file is a JSON object: `{ [sourceId: string]: FeedRecord }`.

**FeedRecord schema (Python dict, serialized to JSON):**
```python
{
    "title": str,
    "description": str,
    "xmlUrl": str,
    "htmlUrl": str | None,
    "language": str,
    "category": str,
    "feedmineSourceId": str,          # 64-char hex
    "feedmineTopic": str,
    "feedmineSubcategory": str,
    "feedmineNature": str,            # "periodic" | "evergreen" | "current-sensitive" | "personal"
    "feedmineActivity": str,          # "prolific" | "active" | "quiet" | "dormant"
    "feedmineArticlesFetched": str,   # integer as string from OPML
    "feedmineDefaultEnabled": str,    # "true" | "false"
    "feedmineMediaKind": str,         # "text" | "audio" | "video"
    "feedmineLatestItemAt": str,      # timestamp w/ TZ offset
    "_opmlPath": str,                 # repo-relative path to source OPML
}
```

**Script behavior:**
1. Read `manifest.json` to get the list of OPML file paths.
2. Parse each OPML file (XML, using `xml.etree.ElementTree`).
3. For every `<outline>` element that has a `feedmineSourceId` attribute, extract all 15 feed-level attributes into a dict.
4. Add `_opmlPath` from the manifest entry.
5. Group records by `feedmineSourceId[:2]` (first 2 hex chars).
6. Write each group to `index/{XX}.json`.
7. Output summary: total feeds indexed, shard count.

**GitHub Actions step** (add after existing publish step):
```yaml
- name: Build feed index shards
  run: python scripts/build_feed_index.py
- name: Commit index shards
  run: |
    git add index/
    git diff --staged --quiet || git commit -m "chore: update feed index shards"
    git push
```

---

### Task 1: Feed Catalog Types and Data Fetching

**Files:**
- Create: `src/lib/feed-catalog.ts`

**Interfaces:**
- Produces: `FeedRecord` type, `CatalogManifest` type, `fetchFeedRecord(sourceId: string): Promise<FeedRecord | null>`, `fetchCatalogManifest(): Promise<CatalogManifest>`, `INDEX_BASE_URL: string`

This module contains all type definitions and data-fetching logic for the feed datasheet. It runs in the browser (client-side), not at build time.

- [ ] **Step 1: Create `src/lib/feed-catalog.ts` with types and constants**

```typescript
/** Matches the index shard structure served by feed-repository. */
export interface FeedRecord {
  title: string;
  description: string;
  xmlUrl: string;
  htmlUrl: string | null;
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
```

- [ ] **Step 2: Add `isValidSourceId` and `getShardKey` helpers**

```typescript
const SOURCE_ID_RE = /^[a-f0-9]{64}$/;

export function isValidSourceId(value: string): boolean {
  return SOURCE_ID_RE.test(value);
}

export function getShardKey(sourceId: string): string {
  return sourceId.substring(0, 2).toLowerCase();
}
```

- [ ] **Step 3: Add `fetchFeedRecord` — fetch shard, find feed by sourceId**

```typescript
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
```

- [ ] **Step 4: Add `fetchCatalogManifest` — fetch manifest for global stats**

```typescript
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
```

- [ ] **Step 5: Add helper functions for display formatting**

```typescript
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
```

- [ ] **Step 6: Verify the module compiles**

Run: `npx tsc --noEmit src/lib/feed-catalog.ts`

- [ ] **Step 7: Commit**

```bash
git add src/lib/feed-catalog.ts
git commit -m "feat: add feed catalog types and data fetching module"
```

---

### Task 2: Feed Datasheet Page

**Files:**
- Create: `src/pages/feed.astro`

**Interfaces:**
- Consumes: `FeedRecord`, `fetchFeedRecord`, `fetchCatalogManifest`, `isValidSourceId`, `getShardKey`, `formatEnabled`, `formatTimestamp`, `formatDate`, `mediaKindLabel`, `activityLabel`, `natureLabel`, `INDEX_BASE_URL` from `src/lib/feed-catalog.ts`

This is the page at `wawasoft.net/feed?sourceId=<hash>`. Astro generates a static HTML shell; all data population happens client-side via a `<script>` block.

- [ ] **Step 1: Create the page shell with Layout, skeleton, and all states**

```astro
---
import Layout from "../layouts/Layout.astro";
---

<Layout
  title="Feed Catalog"
  description="FeedMine catalog entry — datasheet for a feed source."
>
  <div id="feed-datasheet" class="pb-16 pt-8">
    <!-- Breadcrumb -->
    <a
      href="/feedmine"
      class="inline-flex items-center gap-1 text-[13px] text-[#6b6b6b] transition-colors hover:text-[#1a1a1a]"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m15 18-6-6 6-6"/></svg>
      FeedMine Catalog
    </a>

    <!-- SKELETON: replaced by JS on successful load -->
    <div id="feed-content" class="mt-6 space-y-10">
      <!-- Hero skeleton -->
      <div class="animate-pulse space-y-3">
        <div class="h-7 w-64 rounded bg-[#e8e4dd]"></div>
        <div class="h-5 w-full max-w-[560px] rounded bg-[#e8e4dd]"></div>
        <div class="h-4 w-48 rounded bg-[#e8e4dd]"></div>
      </div>

      <!-- Card skeletons -->
      <div class="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map(() => (
          <div class="animate-pulse rounded-lg border border-[#e8e4dd] p-4">
            <div class="mb-2 h-3 w-16 rounded bg-[#e8e4dd]"></div>
            <div class="h-5 w-24 rounded bg-[#e8e4dd]"></div>
          </div>
        ))}
      </div>

      <div class="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map(() => (
          <div class="animate-pulse rounded-lg border border-[#e8e4dd] p-4">
            <div class="mb-2 h-3 w-16 rounded bg-[#e8e4dd]"></div>
            <div class="h-5 w-36 rounded bg-[#e8e4dd]"></div>
          </div>
        ))}
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 2 }).map(() => (
          <div class="animate-pulse rounded-lg border border-[#e8e4dd] p-4">
            <div class="mb-2 h-3 w-16 rounded bg-[#e8e4dd]"></div>
            <div class="h-5 w-40 rounded bg-[#e8e4dd]"></div>
          </div>
        ))}
      </div>

      <!-- Technical skeleton -->
      <div class="animate-pulse space-y-3">
        <div class="h-5 w-20 rounded bg-[#e8e4dd]"></div>
        <div class="h-4 w-full max-w-[520px] rounded bg-[#e8e4dd]"></div>
        <div class="h-4 w-96 rounded bg-[#e8e4dd]"></div>
      </div>

      <!-- Catalog footer skeleton -->
      <div class="animate-pulse rounded-lg border border-[#e8e4dd] p-4">
        <div class="mb-2 h-3 w-32 rounded bg-[#e8e4dd]"></div>
        <div class="h-4 w-72 rounded bg-[#e8e4dd]"></div>
      </div>
    </div>

    <!-- ERROR STATE: hidden by default, shown by JS on error -->
    <div id="feed-error" class="mt-16 hidden text-center">
      <p class="text-[15px] text-[#5c5c5c]" id="feed-error-message">
        Could not load catalog data. The source ID may be invalid or the
        catalog may be temporarily unavailable.
      </p>
      <button
        id="feed-retry"
        class="mt-4 inline-flex items-center gap-1.5 rounded-md border border-[#d4d0c8] px-4 py-2 text-[14px] font-medium text-[#1a1a1a] transition-colors hover:border-[#b0aba0] hover:bg-[#f5f3ef]"
      >
        Retry
      </button>
    </div>

    <!-- NOT FOUND STATE: hidden by default -->
    <div id="feed-not-found" class="mt-16 hidden text-center">
      <p class="text-[15px] text-[#5c5c5c]">
        Source ID not found in the FeedMine catalog.
      </p>
      <a
        href="https://github.com/wawasoft/feed-repository"
        target="_blank"
        rel="noopener noreferrer"
        class="mt-3 inline-flex items-center gap-1.5 text-[14px] font-medium text-[#1a1a1a] underline underline-offset-4 decoration-[#c4bfb4] transition-colors hover:decoration-[#8a8a8a]"
      >
        Browse catalog on GitHub &rarr;
      </a>
    </div>

    <!-- INVALID HASH STATE: hidden by default -->
    <div id="feed-invalid" class="mt-16 hidden text-center">
      <p class="text-[15px] text-[#5c5c5c]">
        Invalid source ID. A source ID is a 64-character hexadecimal string.
      </p>
    </div>
  </div>
</Layout>
```

- [ ] **Step 2: Add the client-side render script**

Append a `<script>` block at the bottom of the page (after `</Layout>`) that imports from `feed-catalog.ts` and handles all states. See **Task 2 Script** below for the complete script.

- [ ] **Step 3: Commit**

```bash
git add src/pages/feed.astro
git commit -m "feat: add feed catalog datasheet page"
```

---

### Task 2 Script: Client-Side Rendering Logic

This is the complete `<script>` block for `src/pages/feed.astro`. It lives inline in the Astro file so it has direct access to DOM element IDs.

- [ ] **Step 1: Add the script with imports, state management, and main flow**

```html
<script>
  import {
    fetchFeedRecord,
    fetchCatalogManifest,
    isValidSourceId,
    formatEnabled,
    formatTimestamp,
    formatDate,
    mediaKindLabel,
    activityLabel,
    natureLabel,
    INDEX_BASE_URL,
  } from "../lib/feed-catalog";

  const sourceId = new URLSearchParams(window.location.search).get("sourceId");

  // DOM refs
  const contentEl = document.getElementById("feed-content")!;
  const errorEl = document.getElementById("feed-error")!;
  const errorMsgEl = document.getElementById("feed-error-message")!;
  const notFoundEl = document.getElementById("feed-not-found")!;
  const invalidEl = document.getElementById("feed-invalid")!;
  const retryBtn = document.getElementById("feed-retry")!;

  function show(el: HTMLElement) {
    el.classList.remove("hidden");
  }

  function hideAll() {
    for (const el of [errorEl, notFoundEl, invalidEl]) {
      el.classList.add("hidden");
    }
  }

  function handleError(message: string) {
    contentEl.innerHTML = "";
    hideAll();
    errorMsgEl.textContent = message;
    show(errorEl);
  }

  async function render() {
    hideAll();

    if (!sourceId) {
      contentEl.innerHTML = "";
      show(invalidEl);
      invalidEl.querySelector("p")!.textContent =
        "No source ID provided. Add ?sourceId=<64-char-hex> to the URL.";
      return;
    }

    if (!isValidSourceId(sourceId)) {
      contentEl.innerHTML = "";
      show(invalidEl);
      return;
    }

    try {
      const [feed, manifest] = await Promise.all([
        fetchFeedRecord(sourceId),
        fetchCatalogManifest(),
      ]);

      if (!feed) {
        contentEl.innerHTML = "";
        show(notFoundEl);
        return;
      }

      contentEl.innerHTML = renderDatasheet(feed, manifest);
    } catch (err) {
      handleError(
        err instanceof Error
          ? err.message
          : "Could not load catalog data. Please try again.",
      );
    }
  }

  retryBtn.addEventListener("click", () => {
    void render();
  });

  void render();
</script>
```

Note: The `renderDatasheet` function is defined in the next step — it's large enough to warrant its own step for readability.

- [ ] **Step 2: Add the `renderDatasheet` function that builds the full HTML**

```html
<script>
  // ... continuation of the script block above ...

  function renderDatasheet(
    feed: import("../lib/feed-catalog").FeedRecord,
    manifest: import("../lib/feed-catalog").CatalogManifest,
  ): string {
    const opmlUrl = `${INDEX_BASE_URL}/${feed._opmlPath}`;
    const repoUrl = `https://github.com/wawasoft/feed-repository/blob/main/${feed._opmlPath}`;

    return `
      <!-- Hero -->
      <div class="rounded-lg border border-[#e8e4dd] p-6">
        <h1 class="text-[22px] font-medium leading-tight text-[#1a1a1a]">
          ${escapeHtml(feed.title)}
        </h1>
        <p class="mt-2 max-w-[620px] text-[15px] leading-relaxed text-[#5c5c5c]">
          ${escapeHtml(feed.description)}
        </p>
        <div class="mt-4 flex flex-wrap gap-x-4 gap-y-1.5 text-[13px] text-[#6b6b6b]">
          ${feed.htmlUrl ? `
            <a href="${escapeAttr(feed.htmlUrl)}" target="_blank" rel="noopener noreferrer"
               class="inline-flex items-center gap-1 underline underline-offset-4 decoration-[#c4bfb4] transition-colors hover:text-[#1a1a1a] hover:decoration-[#8a8a8a]">
              ${iconLink()} ${formatUrl(feed.htmlUrl)}
            </a>` : ""}
          <a href="${escapeAttr(feed.xmlUrl)}" target="_blank" rel="noopener noreferrer"
             class="inline-flex items-center gap-1 underline underline-offset-4 decoration-[#c4bfb4] transition-colors hover:text-[#1a1a1a] hover:decoration-[#8a8a8a]">
            ${iconFeed()} ${formatUrl(feed.xmlUrl)}
          </a>
        </div>
      </div>

      <!-- Identity -->
      <section>
        <h2 class="text-[16px] font-medium text-[#1a1a1a]">Identity</h2>
        <div class="mt-3 grid gap-3 sm:grid-cols-3">
          ${card("Format", "RSS")}
          ${card("Language", feed.language)}
          ${card("Media", mediaKindLabel(feed.feedmineMediaKind))}
        </div>
      </section>

      <!-- Catalog Info -->
      <section>
        <h2 class="text-[16px] font-medium text-[#1a1a1a]">Catalog Info</h2>
        <div class="mt-3 grid gap-3 sm:grid-cols-3">
          ${card("Topic", feed.feedmineTopic)}
          ${card("Subcategory", feed.feedmineSubcategory)}
          ${card("Country", countryFromPath(feed._opmlPath))}
        </div>
        <div class="mt-3 grid gap-3 sm:grid-cols-3">
          ${card("Nature", natureLabel(feed.feedmineNature))}
          ${card("Activity", activityLabel(feed.feedmineActivity))}
          ${card("Default", formatEnabled(feed.feedmineDefaultEnabled))}
        </div>
        <div class="mt-3">
          ${cardBlock("Keywords", escapeHtml(feed.category))}
        </div>
      </section>

      <!-- Activity -->
      <section>
        <h2 class="text-[16px] font-medium text-[#1a1a1a]">Activity</h2>
        <div class="mt-3 grid gap-3 sm:grid-cols-2">
          ${card("Articles cataloged", feed.feedmineArticlesFetched)}
          ${card("Last item observed", formatTimestamp(feed.feedmineLatestItemAt))}
        </div>
        <p class="mt-2 text-[12px] text-[#8a8a8a]">
          Data from the last FeedMine catalog curation. Does not reflect real-time metrics.
        </p>
      </section>

      <!-- Technical -->
      <section>
        <h2 class="text-[16px] font-medium text-[#1a1a1a]">Technical</h2>
        <div class="mt-3 space-y-3">
          ${cardBlock("Source ID", `<span class="font-mono text-[12px] break-all">${escapeHtml(feed.feedmineSourceId)}</span>`)}
          ${cardBlock("OPML file", `<span class="font-mono text-[12px] break-all">${escapeHtml(feed._opmlPath)}</span>`)}
        </div>
      </section>

      <!-- Catalog Footer -->
      <section>
        <h2 class="text-[16px] font-medium text-[#1a1a1a]">FeedMine Catalog</h2>
        <div class="mt-3 rounded-lg border border-[#e8e4dd] p-4">
          <p class="text-[14px] leading-relaxed text-[#5c5c5c]">
            ${manifest.sourceCount.toLocaleString()} sources ·
            ${countryCount(manifest).toString()} countries ·
            ${topicCount(manifest).toString()} topics ·
            ${manifest.fileCount.toLocaleString()} OPML files
          </p>
          <p class="mt-1 text-[13px] text-[#8a8a8a]">
            Catalog updated ${formatDate(manifest.generatedAt)}
          </p>
        </div>
      </section>

      <!-- External links -->
      <div class="flex flex-wrap gap-3">
        <a href="${repoUrl}" target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center gap-1.5 rounded-md border border-[#d4d0c8] px-4 py-2 text-[14px] font-medium text-[#1a1a1a] transition-colors hover:border-[#b0aba0] hover:bg-[#f5f3ef]">
          ${iconGitHub()} View on GitHub &rarr;
        </a>
        <a href="${opmlUrl}" target="_blank" rel="noopener noreferrer"
           class="inline-flex items-center gap-1.5 rounded-md border border-[#d4d0c8] px-4 py-2 text-[14px] font-medium text-[#1a1a1a] transition-colors hover:border-[#b0aba0] hover:bg-[#f5f3ef]">
          ${iconDownload()} Download OPML
        </a>
      </div>

      <!-- Disclaimer -->
      <p class="text-[12px] text-[#8a8a8a]">
        Data from the last FeedMine catalog curation. Does not reflect real-time metrics.
      </p>
    `;
  }

  // --- Helper functions ---

  function card(label: string, value: string): string {
    return `
      <div class="rounded-lg border border-[#e8e4dd] p-4">
        <dt class="font-mono text-[11px] uppercase tracking-wider text-[#8a8a8a]">${escapeHtml(label)}</dt>
        <dd class="mt-1 text-[14px] text-[#1a1a1a]">${escapeHtml(value)}</dd>
      </div>`;
  }

  function cardBlock(label: string, html: string): string {
    return `
      <div class="rounded-lg border border-[#e8e4dd] p-4">
        <dt class="font-mono text-[11px] uppercase tracking-wider text-[#8a8a8a]">${escapeHtml(label)}</dt>
        <dd class="mt-1 text-[14px] text-[#1a1a1a]">${html}</dd>
      </div>`;
  }

  function countryFromPath(path: string): string {
    const match = path.match(/^Feeds\/90_countries\/([^/]+)\//);
    if (!match) return "—";
    return match[1]
      .replace(/_/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function countryCount(manifest: import("../lib/feed-catalog").CatalogManifest): number {
    return manifest.files.filter((f) =>
      f.path.includes("90_countries/"),
    ).length;
  }

  function topicCount(manifest: import("../lib/feed-catalog").CatalogManifest): number {
    // Topic OPMLs are everything NOT in 90_countries/
    return manifest.files.filter((f) =>
      !f.path.includes("90_countries/"),
    ).length;
  }

  function formatUrl(url: string): string {
    try {
      const u = new URL(url);
      return u.hostname + u.pathname;
    } catch {
      return url;
    }
  }

  function escapeHtml(s: string): string {
    const div = document.createElement("div");
    div.appendChild(document.createTextNode(s));
    return div.innerHTML;
  }

  function escapeAttr(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  // --- Inline SVG icons ---

  function iconLink(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>`;
  }

  function iconFeed(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>`;
  }

  function iconGitHub(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"/><path d="M9 18c-4.51 2-5-2-7-2"/></svg>`;
  }

  function iconDownload(): string {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  }
</script>
```

Note: The two `<script>` blocks should be combined into a single `<script>` block in the actual Astro file. They are separated here for readability in the plan.

- [ ] **Step 2b: Ensure TypeScript compiles with the inline script**

Since Astro processes `<script>` tags as vanilla JS by default, wrap the script in `<script type="module">` (which Astro respects for bundling) or use Astro's `is:inline` directive. Since we're importing from `../lib/feed-catalog`, use `<script>` without `is:inline` so Astro bundles and resolves the import.

- [ ] **Step 3: Verify the page builds and renders**

```bash
npm run build
```

Check that `dist/feed/index.html` exists and contains the skeleton HTML.

- [ ] **Step 4: Commit**

```bash
git add src/pages/feed.astro
git commit -m "feat: render feed datasheet client-side from index shards"
```

---

### Task 3: Integration Test

**Files:**
- No new files — manual verification against real data.

- [ ] **Step 1: Start the dev server**

```bash
npm run dev
```

- [ ] **Step 2: Test with a known sourceId from the Brazil OPML**

Open `http://localhost:4321/feed?sourceId=89704d636247725dd4b0f1662fa10b7a9417d1a12030813b27904713d8586536` (FIEPE feed).

Expected: Datasheet renders with title "FIEPE", language "pt-BR", topic "News & Current Affairs".

- [ ] **Step 3: Test with a known sourceId from Technology & Science**

Open `http://localhost:4321/feed?sourceId=4e45f9e1de4bf803b26b554a5cd0615f0efc1fb950e6f6309778ba92ed2c0752` (Tape Op Magazine).

Expected: Datasheet renders with media "Text", nature "periodic".

- [ ] **Step 4: Test error states**

| URL | Expected |
|---|---|
| `/feed` (no param) | "No source ID provided" |
| `/feed?sourceId=abc123` | "Invalid source ID" |
| `/feed?sourceId=0000000000000000000000000000000000000000000000000000000000000000` | "Source ID not found" |

- [ ] **Step 5: Test with a feed that lacks `htmlUrl`**

Find a feed in the catalog where `htmlUrl` is null/absent (some podcast feeds), verify the hero section gracefully omits the website link.

- [ ] **Step 6: Verify visual consistency**

Compare against existing pages (`/feedmine`, `/wawa-note`). Check typography, spacing, border colors, hover states match the site design language.

- [ ] **Step 7: Commit any fixes**

```bash
git add -A
git commit -m "test: verify feed datasheet integration"
```

---

### Task 4: Astro Build Configuration

**Files:**
- Modify: `astro.config.mjs` — ensure the `/feed` page builds correctly. No changes likely needed since it's a standard SSG page with no dynamic params.

- [ ] **Step 1: Verify `npm run build` succeeds**

```bash
npm run build
```

Expected: No errors. `dist/feed/index.html` exists.

- [ ] **Step 2: Verify `dist/feed/index.html` content**

Check that `dist/feed/index.html` contains:
- The Layout shell (header, footer, meta tags)
- The skeleton HTML
- The bundled JS (Astro will bundle the `feed-catalog.ts` import)

- [ ] **Step 3: Run `npm run preview` and spot-check**

```bash
npm run preview
```

Open the preview URL with `?sourceId=<valid-hash>` and verify the datasheet loads.

- [ ] **Step 4: Commit**

```bash
git commit -m "build: verify feed page static generation"
```
