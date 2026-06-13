# Landens Portfolio

A portfolio website where **all content lives in JSON files** — you never have to touch the HTML, CSS, or JavaScript.

## How to run it

Browsers block JSON loading when you open `index.html` directly from the file explorer, so run it through a tiny local server:

- **Easiest:** double-click `Start Website.bat`, then open http://localhost:8000
- Or in a terminal: `python -m http.server 8000` from this folder

## Editing your info — `Website Data/site.json`

| Field | What it does |
|---|---|
| `siteTitle` | The giant text on the first screen |
| `tagline` | Smaller text under the title |
| `email` | Shown in the contact line on every page |
| `heroVideo` | Background video for the first screen. A YouTube link, a local path like `images/background.mp4`, or a direct video URL. It autoplays silently, loops forever, and can't be clicked. Leave it `""` for no video |
| `heroOverlay` | A color tint layered over the hero video, e.g. `"rgba(0, 0, 0, 0.35)"` (last number = how strong). `""` for none |
| `heroTitleColor` | Color of the big title text on the hero |
| `heroTaglineColor` | Color of the smaller text under the title |
| `heroScrollColor` | Color of the SCROLL hint in the bottom corner |
| `featuredBlogs` | The **top 3 projects** on the landing page. Use the blog's file name **without** `.json` |
| `about.image` | Your photo — a URL, or a local path like `images/me.jpg` |
| `about.text` | Your about-me text. Use `\n\n` for a new paragraph |
| `links` | The link buttons (label + url) shown at the bottom of pages |
| `blogsFallbackList` | Only used if the server can't auto-detect blogs — keep it matching your blog files |

## Adding a blog

1. Copy any file in `Website Data/Blogs/`, e.g. to `my-new-project.json`
2. Edit it — it automatically appears on the Blogs page

Each blog file looks like:

```json
{
  "title": "My New Project",
  "date": "June 11, 2026",
  "thumbnail": "images/thumb.png",
  "description": "Short text shown on the blog card.",
  "content": [
    { "type": "heading", "text": "A Section Heading" },
    { "type": "text",    "text": "A paragraph. Link any word like [this](https://example.com)." },
    { "type": "image",   "src": "https://some-site.com/pic.png", "caption": "Optional caption" },
    { "type": "image",   "src": "images/local-pic.png" },
    { "type": "youtube", "url": "https://www.youtube.com/watch?v=VIDEO_ID" }
  ]
}
```

**Content block types:**
- `heading` — a bold section heading. Every heading automatically appears in the table of contents on the left side of the blog page
- `subheading` — a smaller heading; shows up indented and lighter in the table of contents
- `text` — a paragraph. Put `[word](https://url)` anywhere to make that word a clickable link
- `image` — `src` can be a web link **or** a local path starting from this folder (e.g. `images/photo.png`). Put your images in the `images` folder
- `video` — a local video file (e.g. `images/gameplay.mp4`) or a direct video URL, shown with a play button and controls
- `youtube` — paste the full YouTube URL (or just the video id) and it embeds the player

> **Local paths:** always write them with forward slashes (`images/Head Shot.png`). A single backslash (`images\Head Shot.png`) is invalid in JSON and breaks the whole file.

To feature a blog on the landing page, add its file name (without `.json`) to `featuredBlogs` in `site.json`.
