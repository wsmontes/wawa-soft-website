/**
 * Cloudflare Worker — Dynamic OG tags for FeedMine source detail pages.
 *
 * Intercepts /feed?sourceId=… requests from social-media crawlers,
 * fetches the real feed metadata from the public catalog, and injects
 * per-source og:title / og:description so shared links show a rich
 * preview instead of the generic "FeedMine Catalog" fallback.
 *
 * Normal (non-crawler) traffic passes through to the static site.
 *
 * ## Deploy (Cloudflare Dashboard)
 *   1. Workers & Pages → Create application → Create Worker
 *   2. Name it (e.g. "feed-og-worker"), paste this code, Deploy
 *   3. Go to wawasoft.net → Workers Routes → Add route:
 *      Route: wawasoft.net/feed*
 *      Worker: feed-og-worker
 *
 * ## Deploy (wrangler CLI)
 *   npx wrangler deploy
 *
 * Free plan: 100k requests/day — well within budget for crawler traffic.
 */

// ── Crawler user-agent patterns ──────────────────────────────
const CRAWLER_PATTERNS = [
  /twitterbot/i,
  /facebookexternalhit/i,
  /slackbot/i,
  /slack-imgproxy/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /linkedinbot/i,
  /pinterest/i,
  /redditbot/i,
  /googlebot/i,
  /bingbot/i,
  /applebot/i,
  /duckduckbot/i,
  /embedly/i,
  /outbrain/i,
  /w3c_validator/i,
  /validator\.nu/i,
  /ogp\.me/i,
  /iframely/i,
];

// ── Catalog data source ──────────────────────────────────────
const INDEX_BASE =
  "https://raw.githubusercontent.com/wawasoft/feed-repository/main";
const SOURCE_ID_RE = /^[a-f0-9]{64}$/;

// In-memory cache survives across requests within the same Worker
// instance (typically minutes). Saves a round-trip to GitHub on
// repeat crawls.
const cache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// ── Helpers ──────────────────────────────────────────────────

function isCrawler(userAgent) {
  if (!userAgent) return false;
  return CRAWLER_PATTERNS.some((re) => re.test(userAgent));
}

async function fetchFeedRecord(sourceId) {
  const now = Date.now();
  const entry = cache.get(sourceId);
  if (entry && now - entry.ts < CACHE_TTL) return entry.record;

  const shard = sourceId.substring(0, 2).toLowerCase();
  const url = `${INDEX_BASE}/index/${shard}.json`;

  let record = null;
  try {
    const res = await fetch(url);
    if (res.ok) {
      const index = await res.json();
      record = index[sourceId] ?? null;
    }
  } catch {
    // GitHub raw CDN hiccup — return null, caller falls back to origin.
  }

  if (record) {
    try {
      record._host = new URL(record.htmlUrl || "").hostname || null;
    } catch {
      record._host = null;
    }
    cache.set(sourceId, { record, ts: now });
  }

  return record;
}

function escapeAttr(s) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function truncate(s, max) {
  if (!s) return "";
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// ── OG tag injection ─────────────────────────────────────────

function buildOGImageMeta(feedHost) {
  if (!feedHost) return "";
  const url = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(feedHost)}&sz=64`;
  return [
    `<meta property="og:image" content="${escapeAttr(url)}">`,
    `<meta name="twitter:image" content="${escapeAttr(url)}">`,
  ].join("\n");
}

function injectOGTags(html, feed, sourceId) {
  const title = feed.title;
  const desc = feed.description || "View this source in the FeedMine catalog.";
  const host = feed._host || "";
  const ogImageBlock = buildOGImageMeta(host);
  const shareUrl = `https://wawasoft.net/feed/?sourceId=${sourceId}`;

  // Replace existing og/twitter title+description tags with
  // per-source values. Also update <title>.
  //
  // Approach: string replacement is simpler than HTMLRewriter for
  // static tags with known patterns. The static HTML has:
  //   <title>{title} — Wawasoft</title>
  //   <meta property="og:title" content="...">
  //   <meta property="og:description" content="...">
  //   <meta name="twitter:title" content="...">
  //   <meta name="twitter:description" content="...">
  //   <meta name="twitter:card" content="summary">

  let result = html;

  // <title>
  result = result.replace(
    /<title>[^<]*<\/title>/,
    `<title>${escapeAttr(title)} — Wawasoft</title>`
  );

  // <meta name="description">
  result = result.replace(
    /<meta name="description" content="[^"]*">/,
    `<meta name="description" content="${escapeAttr(truncate(desc, 200))}">`
  );

  // og:title
  result = result.replace(
    /<meta property="og:title" content="[^"]*">/,
    `<meta property="og:title" content="${escapeAttr(title)}">`
  );

  // og:description
  result = result.replace(
    /<meta property="og:description" content="[^"]*">/,
    `<meta property="og:description" content="${escapeAttr(truncate(desc, 200))}">`
  );

  // twitter:title
  result = result.replace(
    /<meta name="twitter:title" content="[^"]*">/,
    `<meta name="twitter:title" content="${escapeAttr(title)}">`
  );

  // twitter:description
  result = result.replace(
    /<meta name="twitter:description" content="[^"]*">/,
    `<meta name="twitter:description" content="${escapeAttr(truncate(desc, 200))}">`
  );

  // og:url — use the full share URL with sourceId
  result = result.replace(
    /<meta property="og:url" content="[^"]*">/,
    `<meta property="og:url" content="${escapeAttr(shareUrl)}">`
  );

  // canonical URL
  result = result.replace(
    /<link rel="canonical" href="[^"]*">/,
    `<link rel="canonical" href="${escapeAttr(shareUrl)}">`
  );

  // Inject og:image + twitter:image before </head> if we have one.
  if (ogImageBlock) {
    result = result.replace("</head>", `  ${ogImageBlock}\n</head>`);
    // Switch twitter card to summary (small image alongside text)
    result = result.replace(
      /<meta name="twitter:card" content="[^"]*">/,
      `<meta name="twitter:card" content="summary">`
    );
  }

  return result;
}

// ── Main handler ─────────────────────────────────────────────

addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
    const url = new URL(request.url);

    // Only intercept /feed or /feed/ with a valid sourceId.
    if (url.pathname !== "/feed" && url.pathname !== "/feed/") {
      return fetch(request);
    }

    const sourceId = url.searchParams.get("sourceId");
    if (!sourceId || !SOURCE_ID_RE.test(sourceId)) {
      return fetch(request);
    }

    // Fetch feed data and origin HTML in parallel.
    const [feed, originResponse] = await Promise.all([
      fetchFeedRecord(sourceId),
      fetch(request),
    ]);

    if (!originResponse.ok || !feed) {
      return originResponse;
    }

    const html = await originResponse.text();
    const rewritten = injectOGTags(html, feed, sourceId);

    return new Response(rewritten, {
      status: originResponse.status,
      statusText: originResponse.statusText,
      headers: originResponse.headers,
    });
  }
