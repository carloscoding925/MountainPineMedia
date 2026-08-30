# Mountain Pine Media

Static marketing site for **Mountain Pine Media**, a real estate photo and video studio serving agents and brokerages across Northern Nevada. The site is a single-page portfolio with sections for services, recent work, positioning, pricing, service area, and contact. Inquiries open a pre-filled `mailto:` draft rather than posting to a server, so there's no backend to run.

Live at [mountain-pine-media.com](https://mountain-pine-media.com).

## Tech stack

The site is intentionally simple — no build step, no framework — so it stays fast and easy to maintain.

- **HTML / CSS / vanilla JS** — single `index.html`, single `styles.css`, and one inline `<script>` covering the sticky-nav scroll state, the mobile hamburger toggle, reveal-on-scroll animations via `IntersectionObserver`, and the inquiry form's `mailto:` composition.
- **Google Fonts** — Fraunces, Inter, and IBM Plex Mono, loaded via `<link rel="preconnect">` for fast first paint.
- **Inline SVG** — the brand mark, the hero contour field, the portfolio placeholder tiles, and the service-area map are all hand-drawn SVG rather than image files. Nothing in the layout waits on a network image (see [Placeholder artwork](#placeholder-artwork)).
- **Cloudflare Workers** — deployment target, using Workers static assets. Configured via [`wrangler.jsonc`](web/wrangler.jsonc) with `assets.directory: "."` so the `web/` folder is served as the site root.
- **ImageMagick** — local CLI tool used to resize and recompress listing photos before deploy, and to generate the favicon set (see [Image workflow](#image-workflow)).

## Project structure

```
Mountain-Pine-Media/
├── assets/                    # Original full-resolution photos (NOT deployed — kept for re-processing)
├── web/                       # Everything in here is what gets deployed
│   ├── index.html
│   ├── styles.css
│   ├── wrangler.jsonc         # Cloudflare deploy config
│   ├── favicon.ico            # Browser tab icon (multi-size 16/32/48)
│   ├── apple-touch-icon.png   # iOS / iMessage icon (180×180)
│   ├── og-image.png           # Open Graph link preview (1200×1200)
│   ├── robots.txt             # Allows all crawlers, points at the sitemap
│   ├── sitemap.xml            # Single-URL sitemap (update lastmod on content changes)
│   └── optimized-assets/      # Web-ready listing images (resized + recompressed)
└── README.md
```

The split between `assets/` (project root) and `web/optimized-assets/` is deliberate: only files inside `web/` are served by Cloudflare, so the high-resolution originals never ship to the public site but stay available locally for re-processing.

## Local development

Serve the `web/` folder with any static server:

```bash
cd web
python3 -m http.server 8000
# then visit http://localhost:8000
```

For a closer-to-production preview that mirrors the Cloudflare environment, run wrangler from inside `web/` so it picks up `wrangler.jsonc`:

```bash
cd web
npx wrangler dev
```

`open web/index.html` also works for quick layout and copy tweaks.

## Deployment

Pushes to the `main` branch trigger an automatic build and deploy of the `web/` directory to Cloudflare.

## Placeholder artwork

The six portfolio tiles are not photographs yet — each is a gradient panel with a drawn contour line and a caption tag naming the neighbourhood and listing type. They exist so the grid's proportions and captions are already settled when real galleries land.

To swap one for a real photo, run the image through the pipeline below and replace the tile's `<div class="ph">` and its `<svg>` with a single `<img>`; the `.pf-item` wrapper already handles the 4:5 aspect ratio, the rounded crop, and the caption overlay.

The service-area map is likewise a hand-drawn SVG with hardcoded city dots, not a mapping library — adding a town means adding a `<circle>` and a `<text>` in the same 400×400 coordinate space, plus a matching `.area-tag` chip above it.

## Image workflow

Source photos from the camera are typically 5–10 MB each — far larger than what the web needs. Before adding new photos to the portfolio:

1. Drop the originals into the project-root `assets/` folder (kept out of the deploy).
2. Resize and recompress with ImageMagick into `web/optimized-assets/`:

   ```bash
   cd assets
   for f in your-photos.jpg; do
     magick "$f" \
       -auto-orient \
       -resize '1600x1600>' \
       -strip \
       -interlace Plane \
       -sampling-factor 4:2:0 \
       -quality 82 \
       "../web/optimized-assets/$f"
   done
   ```

   Settings: max 1600px on the long edge (still crisp on retina), JPEG quality 82, EXIF stripped, progressive encoding so images render top-to-bottom as they download.

3. Reference the new file from `index.html` using a path like `optimized-assets/your-photo.jpg`.

### Regenerating the icons

The favicon set and link-preview image are generated from the brand mark — the same ridgeline polyline used in the nav — with ImageMagick draw primitives rather than the SVG source, because ImageMagick's built-in SVG renderer silently drops `stroke` on unfilled paths:

```bash
magick -size 512x512 xc:'#14293A' \
  -fill none -stroke '#B8863B' -strokewidth 40 \
  -draw "stroke-linejoin round stroke-linecap round polyline 56,365 165,183 238,292 310,147 456,365" \
  mark512.png

magick mark512.png -resize 180x180 -background '#14293A' -alpha remove -depth 8 -strip web/apple-touch-icon.png
magick mark512.png \
  \( -clone 0 -resize 48x48 \) \( -clone 0 -resize 32x32 \) \( -clone 0 -resize 16x16 \) \
  -delete 0 web/favicon.ico
```

`og-image.png` is the same mark at 1200×1200 with the wordmark set in Georgia Bold beneath it — a stand-in for Fraunces, which isn't installed locally. If Fraunces is ever installed, point `-font` at it and regenerate for an exact match with the site's headings.

## Contact form

There's no backend, so the inquiry form doesn't POST anywhere. On submit it builds a `mailto:book@mountain-pine-media.com` link with the name, brokerage, email, listing address, and notes formatted into the body, then hands off to the visitor's mail client. The note under the button says so plainly, and names the address as a fallback in case no mail client is registered.

If a real form endpoint is ever wanted, the natural fit is a Cloudflare Worker route alongside the static assets, or a third-party form service — but the `mailto:` path keeps the site fully static today.

## SEO & link previews

The `<head>` includes Open Graph and Twitter Card meta tags pointing at `og-image.png` (the company logo, 1200×1200), so the site renders a proper preview card when shared via iMessage, Slack, Twitter, Discord, etc.

Alongside those:

- **`ProfessionalService` JSON-LD** describing the studio, its service area (Reno, Sparks, Carson City, Minden, Gardnerville, Fernley, Incline Village, Truckee, Washoe County, Northern Nevada), and the five services offered.
- **Canonical link** and a meta description.
- **`robots.txt`** allowing all crawlers and pointing at **`sitemap.xml`**. The sitemap has a single URL and a hardcoded `lastmod` — bump it when the content changes meaningfully.

Note that the biggest remaining wins for search visibility are off-site: a Google Business Profile and Search Console verification.

The domain `mountain-pine-media.com` is hardcoded in four places — the `<head>` meta block and JSON-LD in `index.html`, `robots.txt`, and `sitemap.xml`. Change all four together if it ever moves.
