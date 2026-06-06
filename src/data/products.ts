export const wawaNote = {
  name: "wawa-note",
  version: "1.0.0",
  description:
    "A free, open-source AI workspace that captures meeting evidence — audio, scans, links, notes — and turns it into a searchable project knowledge store with tasks, decisions, and typed relationships. Agentic AI chat navigates your knowledge like a filesystem.",
  github: "https://github.com/wsmontes/wawa-note-ios",
  status: "v1.0.0 — available now",
  platforms: "iOS 17+",
  license: "MIT",
};

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
