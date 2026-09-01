# Mountain Pine Media

Static marketing site for **Mountain Pine Media**, a real estate photo and video studio serving agents and brokerages across Northern Nevada. The site is a single-page portfolio with sections for services, recent work, positioning, pricing, service area, and contact. Inquiries open a pre-filled `mailto:` draft rather than posting to a server, so there's no backend to run.

Live at [mountain-pine-media.com](https://mountain-pine-media.com).

## Tech stack

The site is intentionally simple — no build step, no framework — so it stays fast and easy to maintain.

- **HTML / CSS / vanilla JS** — single `index.html`, single `styles.css`, and one inline `<script>` covering the sticky-nav scroll state, the mobile hamburger toggle, reveal-on-scroll animations via `IntersectionObserver`, and the inquiry form's `mailto:` composition.
- **Google Fonts** — Fraunces, Inter, and IBM Plex Mono, loaded via `<link rel="preconnect">` for fast first paint.
- **Inline SVG** — the brand mark, the hero contour field, and the service-area map are all hand-drawn SVG rather than image files, so nothing above the fold waits on a network image. The **Recent Work** tiles are real photographs (see [Portfolio tiles](#portfolio-tiles)).
- **Vimeo** — the listing films are embedded via Vimeo's iframe player rather than self-hosted. Not just a preference: Cloudflare caps a static asset at 25 MiB and the source films are 74–244 MB each (see [Cinematography](#cinematography)).
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

## Portfolio tiles

**Recent Work** is a mosaic: one feature photo at 2×2 with five supporting tiles around it. Every tile is 3:2 to match the camera's native aspect, so `object-fit: cover` crops almost nothing.

```
+---------------+  +-----+
|               |  | #2  |
|   #1 FEATURE  |  +-----+
|               |  | #3  |
+---------------+  +-----+
+-----+  +-----+  +-----+
| #4  |  | #5  |  | #6  |
+-----+  +-----+  +-----+
```

The feature carries `class="pf-item pf-feature"`; the rest are plain `.pf-item`. To promote a different photo, move that class — the grid re-flows on its own, and source order decides the rest.

The feature's height comes from its `grid-row: span 2`, not from `aspect-ratio` (which is why `.pf-feature` sets `aspect-ratio:auto`). Two stacked 3:2 tiles plus an 18px gap happen to land within a pixel of 3:2 at double width, so the feature reads as the same shape as its neighbours without being told to.

**The gallery breaks out wider than the rest of the page.** `.wrap` stays at 1180px so the text measure and nav are untouched, while `.pf-grid` widens to `min(1520px, 100vw - 64px)` and re-centres with negative margins. Margins rather than a `transform: translateX(-50%)`, because `.pf-grid` also carries `.reveal`, whose entrance animation owns the transform property and would overwrite it.

Measured at a 1920px viewport: feature **1007×671**, supporting tiles **495×330**, every ratio exactly 1.50.

Responsive behaviour — the feature can't keep a 2×2 span once there are fewer than three columns, so both breakpoints reset it:

| Viewport | Columns | Feature | Others |
|---|---|---|---|
| > 900px | 3 | 1007×671 (2×2) | 495×330 |
| ≤ 900px | 2 | 796×531 (full-width banner) | 389×259 |
| ≤ 600px | 1 | 436×291 (same as the rest) | 436×291 |

### Image resolution and the hover zoom

The feature tile renders about 1007 CSS px wide, so a 2× display needs ~2014px of source — more than the 1600px the standard pipeline produces. It therefore gets a second export at 2400px and a `srcset`, and is the only image that needs one; the supporting tiles at 495 CSS px are covered by 1600px even at 2×.

```bash
magick "twilight 2.jpg" -auto-orient -resize '2400x2400>' -strip \
  -interlace Plane -sampling-factor 4:2:0 -quality 82 \
  "../web/optimized-assets/twilight-2-2400.jpg"
```

Gallery payload: **1.44 MB** on a 1× display, **1.73 MB** on 2×. If a different photo is promoted to the feature slot, give it the 2400px export too — otherwise it will look soft on retina.

Tiles zoom slightly on hover. Chrome rasterizes a layer at its layout size and then GPU-scales that bitmap, so a `scale()` on an un-promoted layer visibly softens until the browser re-rasterizes; `.pf-item img` sets `will-change:transform` under `@media(hover:hover)` so the layer is composited up front. The zoom is disabled entirely under `prefers-reduced-motion`.

The service-area map is still a hand-drawn SVG with hardcoded city dots, not a mapping library — adding a town means adding a `<circle>` and a `<text>` in the same 400×400 coordinate space, plus a matching `.area-tag` chip above it.

## Cinematography

A centre-focus carousel of vertical listing films, sitting between **Recent Work** and **Why Mountain Pine** on the Pricing section's `#E4EDEC` ground. The focused film sits dead centre with its neighbours peeking either side, and the ends wrap around. Arrows, dots, arrow keys, and horizontal swipe all move it; only the focused film is playable, and clicking a neighbour pulls it into focus instead.

### Swipe, and why it needs a capture layer

Swipe listeners live on `.cine-track`, but a cross-origin iframe consumes the pointer events over it, and the focused film's iframe is deliberately `pointer-events:auto` so Vimeo can run its own controls. On desktop that costs nothing — the focused slide is 32% of the track, so there is open ground either side to start a gesture on. On a phone the focused slide is **72%** of the track and only the slivers of the peeking neighbours were live: measured 7 of 11 sample points across the track dead to the handler, which left the arrows as the only way to move.

`.cine-swipe` is a transparent layer over the focused film, shown only under `@media(pointer:coarse)` so desktop behaviour is untouched. Its events bubble to the track, so one handler still serves both it and the open ground. Two details:

- **It stops 46px short of the bottom.** Vimeo's control bar lives there and stays directly usable — the layer would otherwise swallow scrubbing and the overflow menu.
- **It relays taps.** A tap that the layer intercepts would have reached the player, so the script forwards it as play/pause. Vimeo has no toggle method, so state is tracked in a `Map`, and the script subscribes to the player's own `play`/`pause` events over `postMessage` to stay honest when someone uses that exposed control bar.

Navigation needs horizontal intent — more than 40px of travel *and* more horizontal than vertical — so a diagonal flick while scrolling past the section doesn't move the carousel.

### Why the films used to play muted on a phone

Both ways of starting a film went through `postMessage`, and **user activation does not cross an origin boundary**. The player therefore saw a programmatic play, the browser's autoplay policy withheld sound, and Vimeo fell back to muted playback rather than not playing at all.

It only showed up on a phone because the two affected paths are the mobile ones:

- **The carousel.** `.cine-swipe` exists only under `@media(pointer:coarse)`, so on desktop a tap lands inside the iframe and is a real gesture in Vimeo's own origin. On a phone our layer intercepts it and relays `{method:'play'}` instead. This is also why it was intermittent rather than constant — the layer stops 46px short of the bottom, so a tap on Vimeo's exposed control bar *is* an in-frame gesture and played with sound, while a tap in the middle did not.
- **The lightbox.** `autoplay=1` on a freshly created iframe is only ever granted muted on mobile.

The fix is to send `setMuted:false` alongside the play we initiate. **`setMuted`, not `setVolume`** — Vimeo documents `setVolume` as silently ignored on iOS and Android, where volume belongs to the system, so it fails without an error.

The carousel unmutes only the *first* time a given slide is started (tracked in a `WeakSet`), so someone who deliberately mutes with Vimeo's own control isn't overridden on the next tap. The lightbox unmutes on player load and once more on its first `play` event, because the muted fallback can land after `load`.

Playing muted is the browser's designed fallback, so this cannot be fully verified on desktop — desktop grants unmuted autoplay and never enters the failing state. Confirm on a real handset.

The films are **hosted on Vimeo, not self-hosted** — the same call Lake & Pine made, and here it is forced. Cloudflare Workers static assets cap an individual file at **25 MiB** on every plan, and the source films are 74–244 MB of 4K portrait footage. Getting them under that ceiling means transcoding to roughly 1080×1920 and giving up adaptive bitrate; Vimeo sidesteps the limit, keeps ~500 MB of video out of the repository, and serves an appropriate rendition per connection.

### Swapping in a film

Each slide carries its Vimeo id once, in the iframe `src`:

```html
<div class="cine-slide" data-featured>
  <div class="cine-thumb">
    <iframe src="https://player.vimeo.com/video/VIDEO_ID?api=1&title=0&byline=0&portrait=0&player_id=cine-0" ...></iframe>
```

The id is the trailing digits of a `vimeo.com/1234567890` URL. `data-featured` marks the slide in focus on load — exactly one slide should have it.

The four films currently on the page. **DOM order is not visual order** — see below:

| DOM index | Vimeo id | Title | Caption | At rest |
|---|---|---|---|---|
| 0 (featured) | `1222570040` | Crystal - Agent Feature | 27-second intro reel | centre |
| 1 | `1222570041` | Family Move In | 1-minute client story | right |
| 2 | `1222570042` | Daisy — Agent Introduction | 29-second intro reel | **hidden** |
| 3 | `1222570043` | Listing Reel | 43-second walkthrough | left |

With four slides the offsets the carousel hands out are `{-1, 0, 1, 2}`, and only `d=2` falls outside the track — so **index 2 is the hidden slot, not the last index**. Index 3 wraps around to `d=-1` and becomes the visible left neighbour. The weaker film sits at index 2 deliberately; moving it to the end of the markup would put it on screen and hide the listing reel instead. It stays reachable by arrow, dot, and swipe.

An odd number of films is tidier — three gives a symmetric `{-1, 0, 1}` with nothing parked off-track. If a fifth film is added, that symmetry returns and the hidden slot disappears.

Captions are hand-written, not read from Vimeo, so they can drift from the real durations — slide 3's film is 43 seconds by Vimeo's own count and the player badge says so on the thumbnail. The carousel counts slides at runtime, so adding or removing a film needs only a matching `.cine-dot` button.

### Portrait geometry

Two things about the layout are load-bearing:

- **Slides are `min(330px, 32%, 42vh)` wide.** Three caps, because a 9:16 player grows tall fast: an absolute ceiling, a share of the track, and a share of the viewport height — the last keeps a portrait film from running off the bottom of a short laptop screen. Measured 330×587 for the player at desktop, down to 252×448 on a 390px phone, always exactly 9:16.
- **Neighbours sit at `translateX(±100%) scale(0.82)`.** At 330px wide that puts a neighbour's inner edge 30px clear of the focused slide. Narrowing the slide without revisiting the transform will overlap them.

### Why the lightbox exists here

Lake & Pine sizes its slides at 648px specifically because **Vimeo collapses its control bar — fullscreen included — below roughly 620px of player width**. A 9:16 player cannot reach 620px wide without standing ~1100px tall, so portrait films are *always* in the collapsed state, in the carousel and in the lightbox alike. That makes the expand control more important than it is on the sibling site, not less: the lightbox reopens the film at up to 430px and the bar beneath it carries our own `FULLSCREEN` button, so nobody has to hunt through Vimeo's overflow menu.

That button is hidden on iPhone — iOS Safari has never supported the Fullscreen API on arbitrary elements, and the `<video>` it would need lives inside Vimeo's cross-origin iframe. iPhone visitors use Vimeo's own control. macOS and iPad Safari are covered by the `webkit`-prefixed fallbacks in both the script and `styles.css`. If the browser refuses our fullscreen request outright, the code falls back to asking the Vimeo player to go fullscreen itself over `postMessage`.

The lightbox tears its iframe down on close rather than after the fade, so audio stops the moment the film is dismissed.

**Sizing is a vertical budget, not a free-for-all.** The close button sits in the top-right corner, absolutely positioned, and it is the *first* child — the player is positioned and comes later, so without an explicit `z-index` the video paints over it and swallows the tap. That is a real failure mode, not a theoretical one: on a 667px-tall screen the centred player rode up to 20px from the top and `elementFromPoint` over the button returned the Vimeo iframe.

Two things keep it fixed, and both are needed:

- `.cine-lb-close` carries `z-index:3`, so it wins if the two ever meet again.
- `--lb-chrome` (164px, or 128px under `max-height:480px`) is the vertical space the player is *not* allowed to spend — the button's corner, the gap, the caption bar, the bottom padding. The player's width derives from what's left: `min(430px, 92vw, calc((100svh - var(--lb-chrome)) * 9 / 16))`. `svh` rather than `vh` so mobile browser chrome counts, with a `vh` line above as the fallback.

That budget only works if the bar's height is predictable, so the caption is pinned to one line each with `text-overflow:ellipsis` — a wrapping title silently overflowed it before. To buy the caption room back, the `FULLSCREEN` button drops to its icon under 420px wide or 480px tall, and `syncFsLabel()` mirrors the label into an `aria-label` because `display:none` hides the span from screen readers too.

Verified with the lightbox open at 390×844, 390×667, 360×640, 320×568, 844×390, 768×1024 and 1920×1080: no overlap, button hit-testable, caption bar on screen, player exactly 9:16. Desktop and iPad are untouched at 430×764.

## Image workflow

Source photos from the camera are typically 5–10 MB each — far larger than what the web needs. Before adding new photos to the portfolio:

1. Drop the originals into the project-root `assets/` folder (kept out of the deploy).
2. Resize and recompress with ImageMagick into `web/optimized-assets/`:

   ```bash
   cd assets
   for f in your-photos.jpg; do
     out="$(echo "$f" | tr ' ' '-')"
     magick "$f" \
       -auto-orient \
       -resize '1600x1600>' \
       -strip \
       -interlace Plane \
       -sampling-factor 4:2:0 \
       -quality 82 \
       "../web/optimized-assets/$out"
   done
   ```

   Settings: max 1600px on the long edge (still crisp on retina), JPEG quality 82, EXIF stripped, progressive encoding so images render top-to-bottom as they download.

   Give the output a URL-safe name — no spaces. The loop above pipes filenames through `tr ' ' '-'` for that reason, so `drone twilight.jpg` in `assets/` lands as `drone-twilight.jpg` in `optimized-assets/`.

3. Reference the new file from `index.html` using a path like `optimized-assets/your-photo.jpg`.

This pipeline took the nine current listing photos from ~102 MB of originals down to ~2.8 MB web-ready (the six on the page total ~1.4 MB) with no visible quality loss.

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

There's no backend, so the inquiry form doesn't POST anywhere. On submit it builds a `mailto:mtnpinemedia@gmail.com` link with the name, brokerage, email, listing address, and notes formatted into the body, then hands off to the visitor's mail client. The note under the button says so plainly, and names the address as a fallback in case no mail client is registered.

If a real form endpoint is ever wanted, the natural fit is a Cloudflare Worker route alongside the static assets, or a third-party form service — but the `mailto:` path keeps the site fully static today.

## SEO & link previews

The `<head>` includes Open Graph and Twitter Card meta tags pointing at `og-image.png` (the company logo, 1200×1200), so the site renders a proper preview card when shared via iMessage, Slack, Twitter, Discord, etc.

Alongside those:

- **`ProfessionalService` JSON-LD** describing the studio, its service area (Reno, Sparks, Carson City, Minden, Gardnerville, Fernley, Incline Village, Truckee, Washoe County, Northern Nevada), and the five services offered.
- **Canonical link** and a meta description.
- **`robots.txt`** allowing all crawlers and pointing at **`sitemap.xml`**. The sitemap has a single URL and a hardcoded `lastmod` — bump it when the content changes meaningfully.

Note that the biggest remaining wins for search visibility are off-site: a Google Business Profile and Search Console verification.

The domain `mountain-pine-media.com` is hardcoded in four places — the `<head>` meta block and JSON-LD in `index.html`, `robots.txt`, and `sitemap.xml`. Change all four together if it ever moves.
