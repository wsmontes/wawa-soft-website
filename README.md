# Wawasoft website

The public site for [Wawasoft](https://wawasoft.net), an independent software
company based in Victoria, British Columbia.

## FeedMine

[FeedMine](https://wawasoft.net/feedmine/) is an open-source iOS reader for
news, podcasts, video, and independent publishing. Wawasoft maintains the app
and its curated catalog; the source code is available under the MIT License.

- Application source: [wsmontes/feedmine](https://github.com/wsmontes/feedmine)
- Catalog updates: [wawasoft/feedmine-repo](https://github.com/wawasoft/feedmine-repo)

## Development

```sh
npm install
npm run dev
```

Run `npm run build` before publishing to generate the production site in
`dist/`.

## Publishing a blog post

Create a Markdown file in `src/content/blog/` with this frontmatter:

```md
---
title: "Post title"
description: "A short summary used on the blog index and in the RSS feed."
publishDate: 2026-07-21
author: "Wagner Montes"
tags:
  - Open source
draft: false
---

Write the post here.
```

Posts marked as drafts or dated in the future are excluded from the site and
RSS feed. Published posts appear at `/blog/`, and the feed is available at
`/rss.xml`.
