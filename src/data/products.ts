export const feedmine = {
  name: "Feedmine",
  summary:
    "A calmer iOS reader for RSS, podcasts, YouTube, and local news around the world.",
  description:
    "A native iOS news and podcast reader that turns RSS, Atom, JSON Feed, podcasts, and YouTube channels into a calmer, source-first feed. It ships with a global catalog of 61,000+ sources across 190+ countries, local search, bookmarks, and exportable collections.",
  github: "https://github.com/wsmontes/feedmine",
  status: "in development — iOS app",
  platforms: "iOS 18+",
  license: "Proprietary",
  href: "/feedmine",
  icon: "/feedmine-symbol.png",
  wordmark: "/feedmine-wordmark.png",
};

export const wawaNote = {
  name: "wawa-note",
  version: "1.0.0",
  summary:
    "An open-source AI workspace for meeting evidence, project memory, tasks, and decisions.",
  description:
    "A free, open-source AI workspace that captures meeting evidence — audio, scans, links, notes — and turns it into a searchable project knowledge store with tasks, decisions, and typed relationships. Agentic AI chat navigates your knowledge like a filesystem.",
  github: "https://github.com/wsmontes/wawa-note-ios",
  status: "v1.0.0 — available now",
  platforms: "iOS 17+",
  license: "MIT",
  href: "/wawa-note",
  icon: "/symbol-gradient.png",
};

export const products = [feedmine, wawaNote];

export const principles = [
  {
    title: "Open source when possible",
    detail:
      "Public code means anyone can inspect, modify, or learn from the work.",
  },
  {
    title: "Local files first",
    detail:
      "Your data stays on your machine. Cloud features are optional, never required.",
  },
  {
    title: "No unnecessary lock-in",
    detail:
      "Export your data in standard formats. Move on whenever you want.",
  },
  {
    title: "Useful before impressive",
    detail:
      "Tools should solve real problems for real people. Polish comes after utility.",
  },
];

export const wawaNoteSections = [
  {
    title: "What it is",
    body: "wawa-note is an AI workspace that captures meeting evidence — audio recordings, document scans, web bookmarks, notes — and transforms it into a canonical project knowledge store. It has an agentic AI chat that navigates your knowledge using shell-like commands, and a project graph with typed relationships, tasks, and decisions, all with evidence provenance.",
  },
  {
    title: "What it does",
    body: "Record meetings with audio and on-device transcription. Scan documents with VisionKit OCR. Import from 10 formats (JSON, Markdown, ICS, SRT, PDF, HTML, RTF, and more). AI extracts, analyzes, and organizes everything automatically. Chat with your knowledge across projects. Browse timeline, task boards, and graph views. Export to Markdown, JSON, CSV, and more.",
  },
  {
    title: "Why I'm building it",
    body: "I wanted a tool where I could capture meeting notes, audio, and project material, have AI help me organize it, and still own my data at the end. Existing AI note apps lock you into their cloud and their AI provider. wawa-note lets you bring your own API keys, choose your provider, and keep everything local.",
  },
  {
    title: "Current status",
    body: "wawa-note v1.0.0 is available on GitHub. It runs on iOS 17+, built with Swift 6.0 and SwiftUI. The core loop — capture, analyze, organize, chat — is fully functional. New features like on-device LLM inference and deeper Apple ecosystem integrations are in progress.",
  },
];

export const feedmineStats = [
  { label: "Sources", value: "61,000+" },
  { label: "Countries", value: "190+" },
  { label: "OPML files", value: "4,534" },
  { label: "Catalog nodes", value: "12,607" },
];

export const feedmineSections = [
  {
    title: "What it is",
    body: "Feedmine is a source-first reader for iPhone. It brings articles, podcasts, and YouTube channels into one feed without making the algorithm the main character. You choose the sources, topics, countries, and collections. Feedmine does the fetching, parsing, filtering, saving, and exporting.",
  },
  {
    title: "What it does",
    body: "The app reads RSS, Atom, JSON Feed, podcast feeds, YouTube channel feeds, and pasted links. It includes a large prebuilt catalog, local full-text search, bookmarks, custom lists, saved searches, an in-app reader, OPML import/export, and a scheduler that keeps the feed diverse instead of letting one loud source take over.",
  },
  {
    title: "Why I'm building it",
    body: "News discovery has moved into feeds that optimize for retention, outrage, and platform control. I wanted a reader that points back to publishers, makes local and global sources easier to find, and lets people build their own information diet without accounts, ads, or a black-box ranking system.",
  },
  {
    title: "Current status",
    body: "Feedmine is in active development. The app has its main SwiftUI experience, feed engine, SQLite catalog, local search, bookmarks, import pipeline, export tools, and brand system in place. The remaining work is focused on stability, onboarding, dark mode, and App Store polish.",
  },
];
