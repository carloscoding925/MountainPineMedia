# Mountain Pine Media

Static marketing site for **Mountain Pine Media**, a real estate photo and video studio serving agents and brokerages across Northern Nevada. The site is a single-page portfolio with sections for services, recent work, positioning, pricing, service area, and contact. The one piece of server-side code is a small Worker that takes the inquiry form's submission and emails it to the studio (see [Inquiry form](#inquiry-form)).

Live at [mountain-pine-media.com](https://mountain-pine-media.com).

## Tech stack

The site is intentionally simple — no build step, no framework — so it stays fast and easy to maintain.

- **HTML / CSS / vanilla JS** — single `index.html`, single `styles.css`, and one inline `<script>` covering the sticky-nav scroll state, the mobile hamburger toggle, reveal-on-scroll animations via `IntersectionObserver`, the parallax, the film carousel and lightbox, and the inquiry form's submission.
- **Google Fonts** — Fraunces, Inter, and IBM Plex Mono, loaded via `<link rel="preconnect">` for fast first paint.
- **Inline SVG** — the brand mark, the hero contour field, and the service-area map are all hand-drawn SVG rather than image files. The **Recent Work** tiles are real photographs (see [Portfolio tiles](#portfolio-tiles)).
- **Photographic section backgrounds** — the hero and Service Area sit on a listing photo that parallaxes as the page scrolls (see [Parallax](#parallax)). This is a deliberate reversal of an older rule that nothing above the fold waited on a network image: the hero's backdrop is now a ~524 KB download, mitigated with a `<link rel="preload">` but not free. The hero still paints its `--lake-deep` ground immediately, so text is legible before the photo lands.
- **Vimeo** — the listing films are embedded via Vimeo's iframe player rather than self-hosted. Not just a preference: Cloudflare caps a static asset at 25 MiB and the source films are 74–244 MB each (see [Cinematography](#cinematography)).
- **Cloudflare Workers** — deployment target, using Workers static assets. Configured via [`wrangler.jsonc`](web/wrangler.jsonc) with `assets.directory: "./public"`, so `web/public/` is the site root and `web/worker.js` sits outside it and is never itself servable.
- **Resend** — transactional email API the inquiry Worker posts to. The API key lives in Worker secrets, never in the repo.
- **Cloudflare Turnstile** — CAPTCHA alternative guarding the inquiry form, verified server-side in the Worker (see [Spam filtering](#spam-filtering)).
- **ImageMagick** — local CLI tool used to resize and recompress listing photos before deploy, and to generate the favicon set (see [Image workflow](#image-workflow)).

## Project structure

```
Mountain-Pine-Media/
├── assets/                    # Original full-resolution photos (NOT deployed — kept for re-processing)
├── web/                          # Wrangler's root — nothing here is served except public/
│   ├── wrangler.jsonc            # Cloudflare deploy config
│   ├── worker.js                 # /api/inquiry endpoint; falls through to assets
│   ├── email.js                  # Notification email template (worker + preview share it)
│   ├── preview-email.mjs         # Renders that email locally without sending
│   └── public/                   # Everything in here is what gets served
│       ├── index.html
│       ├── styles.css
│       ├── favicon.ico           # Browser tab icon (multi-size 16/32/48)
│       ├── apple-touch-icon.png  # iOS / iMessage icon (180×180)
│       ├── og-image.png          # Open Graph link preview (1200×1200)
│       ├── robots.txt            # Allows all crawlers, points at the sitemap
│       ├── sitemap.xml           # Single-URL sitemap (update lastmod on content changes)
│       └── optimized-assets/     # Web-ready listing images (resized + recompressed)
└── README.md
```

The split between `assets/` (project root) and `web/public/optimized-assets/` is deliberate: only files inside `web/public/` are served by Cloudflare, so the high-resolution originals never ship to the public site but stay available locally for re-processing.

`worker.js`, `email.js`, and `preview-email.mjs` sit beside `public/` rather than inside it for the same reason — anything in the assets directory becomes a public URL. That was not hypothetical: before this layout the assets directory was `web/` itself, and `mountain-pine-media.com/wrangler.jsonc` served the deploy config to anyone who asked. Verified under `wrangler dev`: `/worker.js`, `/email.js`, `/wrangler.jsonc`, and `/.dev.vars` all 404.

## Local development

Serve the `web/public/` folder with any static server:

```bash
cd web/public
python3 -m http.server 8000
# then visit http://localhost:8000
```

This serves the page but not the Worker, so submitting the inquiry form will fail — that path needs `wrangler dev` below.

For a closer-to-production preview that mirrors the Cloudflare environment — and the only way to exercise the inquiry endpoint — run wrangler from inside `web/` so it picks up `wrangler.jsonc`:

```bash
cd web
npx wrangler dev
```

`open web/public/index.html` also works for quick layout and copy tweaks, but serve over HTTP when testing the films or the form — they talk to Vimeo and Turnstile across origins, which behaves differently from `file://`.

## Deployment

Pushes to the `main` branch trigger an automatic build and deploy of the `web/` directory to Cloudflare.

The inquiry Worker needs two secrets, `RESEND_API_KEY` and `TURNSTILE_SECRET_KEY`, and **production and local dev read them from two different places**.

For the deployed Worker, set them in the dashboard (**Workers & Pages → mountain-pine-media → Settings → Variables and Secrets**) or with wrangler, which prompts for the value so it never reaches your shell history:

```bash
cd web
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put TURNSTILE_SECRET_KEY
```

Wrangler refuses `secret put` when the Worker's latest version isn't the active deployment (Lake & Pine's README has the exact error). The dashboard isn't subject to that check, which makes it the way to have both secrets in place *before* the deploy that first needs them. Secrets persist across later `wrangler deploy` runs.

For `wrangler dev`, put them in `web/.dev.vars` (gitignored, alongside `wrangler.jsonc` — not the repo root). Locally `TURNSTILE_SECRET_KEY` is Cloudflare's always-passing dummy secret, so no real credential is needed to exercise the guardrails — see [The testing keys](#the-testing-keys-and-the-trap-in-them).

Without `RESEND_API_KEY` the endpoint returns `500 {"error":"Email is not configured."}`; with a bad key it returns `502`. Without `TURNSTILE_SECRET_KEY` it returns `500 {"error":"Spam protection is not configured."}`. Those three responses are the quickest way to tell which half is misconfigured.

`INQUIRY_TO` and `INQUIRY_FROM` are optional overrides; without them the Worker sends to `mtnpinemedia@gmail.com` from `inquiries@mountain-pine-media.com`. `ALLOWED_ORIGINS` and `TURNSTILE_EXPECT_HOSTNAME` are optional too, and only needed if the site is ever served from a hostname the Worker doesn't see as its own.

**Resend's free plan sends 100 emails a day and 3,000 a month, across up to 3 domains.** Going over is a hard stop, not an overage charge: the API answers `429` and refuses the send until the quota resets. The Worker turns any Resend failure into a `502`, and **the inquiry is not queued or retried — it is lost**, so the agent sees the "email us instead" message. The quota is per Resend account, so if this domain is added to the same account as Lake & Pine's, the two sites share the 100 a day.

### First deploy of the inquiry form

The form fails closed: until every piece below is in place, every inquiry gets the "email us instead" message rather than going anywhere. In order:

1. **Turnstile widget.** Create one in the Cloudflare dashboard for both `mountain-pine-media.com` and `www.mountain-pine-media.com` — both, because `www` serves the site rather than redirecting to the apex, so a single-hostname widget fails for anyone who lands there. Put its sitekey in `data-sitekey` on `#inquiry-turnstile` in `index.html`, replacing the testing key.
2. **Resend domain.** Add `mountain-pine-media.com` in Resend and create its DNS records in Cloudflare — see [Email authentication](#email-authentication-spf-dkim-dmarc), because this domain's current records reject all mail until that's done. Wait for Resend to show the domain as verified, then create an API key.
3. **Secrets.** Set `TURNSTILE_SECRET_KEY` (the widget's secret) and `RESEND_API_KEY` in the dashboard.
4. **Merge to `main`.** Then submit one real inquiry and confirm it arrives in `mtnpinemedia@gmail.com`. Gmail may file the first few from a new sender under spam; marking one "not spam" settles it.

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
  "../web/public/optimized-assets/twilight-2-2400.jpg"
```

Gallery payload: **1.44 MB** on a 1× display, **1.73 MB** on 2×. If a different photo is promoted to the feature slot, give it the 2400px export too — otherwise it will look soft on retina.

Tiles zoom slightly on hover. Chrome rasterizes a layer at its layout size and then GPU-scales that bitmap, so a `scale()` on an un-promoted layer visibly softens until the browser re-rasterizes; `.pf-item img` sets `will-change:transform` under `@media(hover:hover)` so the layer is composited up front. The zoom is disabled entirely under `prefers-reduced-motion`.

## Service Area

The whole section is a listing photo, and it is the one place on the site where a photograph is the ground rather than the content. `.area` is three layers: `::before` is the photo and the only thing that moves, `::after` is the scrim, and `.wrap` rides above both on `z-index:2`.

Everything in the section is therefore light-on-dark, the way `.contact` is. Two of those are easy to miss when editing:

- **The lede is a class, not an inline style.** It used to carry `color:var(--lake-mid)` inline, which beats any stylesheet rule — it is `.area-lede` now precisely so the palette can be changed in one place.
- **The chips have a ground.** `.area-tag` on a busy photo reads as stray strokes when it is only an outline, so it gets `rgba(20,41,58,0.45)` and a small blur, the same move `.pf-tag` makes over the gallery photos.

### The map

Still a hand-drawn SVG with hardcoded city dots, not a mapping library — adding a town means adding a `<circle>` and a `<text>` in the same 400×400 coordinate space, plus a matching `.area-tag` chip above it. The panel has **no photo of its own** — the section carries it, and `.area-map` is just the frame that gives the dots a coordinate space. Its border is `--line` rather than `--stone`, the light-on-dark swap `.price-card.feat` also makes.

Three things follow from the map sitting on a photograph, and each one bit:

- **The SVG has no background `<rect>`.** It used to open with `<rect width="400" height="400" fill="#F4F7F7"/>`, which is opaque and would hide the photo entirely.
- **Dots and labels are the light-on-dark set** (`#F4F7F7` for Reno, `#D8E1E0` for the other six, contours at `#F4F7F7`/0.28), matching how `.portfolio` and `.stat-block` treat a `--lake-deep` ground. A new town added in the old dark colours will disappear. The scrim evens the photo out but can't flatten it, so `.area-map svg text` also carries a shadow for the labels that land on a bright sill or a pendant lamp.
- **Watch the right edge.** IBM Plex Mono advances ~6 units per character at `font-size:10`, so a label placed to the right of a dot past about x=300 runs into the border — "Incline Village" is 15 characters, and when it sat on the right flank it ran to 398 of 400 and clipped. Nothing reaches that far now: Sparks is the rightmost label and still leaves 74px of frame at desktop.

The seven nodes fall into two groups, which is both the real geography and what keeps the labels apart:

| | Nodes (x, y) | Notes |
|---|---|---|
| Tahoe basin | Truckee (92, 130), Incline Village (120, 175), Tahoe (106, 255) | Staggered west to east, labels running right |
| Valley towns | Reno (245, 185), Sparks (300, 160), Carson City (255, 280) | East of the lake, as they are on the ground |

The basin three are deliberately not on a shared x — the stagger follows the real west-to-east order, Truckee being the westernmost and Incline Village the easternmost with the lake between. Incline gets the smaller push of the two: its label is the longest on the map, and every unit it moves right comes off the gap to Reno's dot, which is down to 30px at desktop.

The two longest labels — "Incline Village" and "Carson City" — end up on separate flanks, so neither has to reach across the other.

Coordinates are baked rather than applied with a `translate()` group on purpose: the right-edge budget above is measured against the raw 400-unit viewBox, and a shifted group would leave the numbers in the markup out from the space that budget is reasoned in.

## Parallax

Two sections sit on a photograph that drifts down as the page scrolls down, so it reads slower than the content on top of it: the **hero** and **Service Area**. A section opts in with a `data-parallax` attribute, which is both what the shared CSS block styles and what the script queries — a section styled but not marked simply sits at rest.

Each section is layered, bottom to top: `::before` is the photo and the only thing that moves, `::after` is the scrim, and the content rides above. Because the scrim sits *above* the moving photo, contrast is identical at every scroll offset — copy never drifts into a bright patch.

Only a custom property changes per frame — `--parallax`, consumed by a `translate3d` on `::before` — so this stays a compositor transform and never touches paint. One rAF-coalesced handler serves every section, and an `IntersectionObserver` keeps a `Set` of the ones actually on screen, so the hero costs nothing while you are reading the footer. It bails entirely under `prefers-reduced-motion`; with no JS at all the layers rest at their centres, which is why the transform reads `var(--parallax, 0px)`.

**Two numbers, and they are not the same number.** `TRAVEL` in the script (0.14) is the fraction of a section's height the layer actually moves. `--parallax-overscan` in the stylesheet (16%) is how far the layer is grown past the section's top and bottom to have somewhere to move *to*. Overscan must stay **>= travel**; the two points between them are margin, because at equal values the layer's edge lands exactly flush at the extremes and sub-pixel rounding can flash a hairline. Set travel above overscan and an empty edge slides into frame.

Measured at 1920×929:

| Section | Height | Travel each way | Edge clearance at full travel | Effect |
|---|---|---|---|---|
| Hero | 929px | 130.1px | 18.5px | ~12.3% slower |
| Service Area | 749px | 104.9px | 14.8px | ~12.5% slower |

**The hero only ever spends half its travel.** It is at the top of the document, so it starts mid-pass at `--parallax: 0` rather than at the `+1` an incoming section gets, and can only drift downward from there. That is correct, not a bug.

The overscan is free at these widths. Full-bleed, the box is far wider than the 3:2 source, so `cover` is limited by **width** — growing the layer taller crops nothing at all. That was not true when this lived on the square map panel, which was limited by height, where every point of overscan came straight off the visible width.

### Scrims are per-section, and they are measured

**The two scrims are shaped differently because the two photographs are.** They are not interchangeable, and swapping either image means re-deriving its scrim.

- **Hero** (interior, `DSC08587`) — a vertical wash *plus a left-weighted pass*. The brightest thing in frame is the window wall on the left, which is exactly where the copy sits. It is also the heavier of the two overall, because the contour linework above it is hairline white at 0.08–0.2 opacity and needs a genuinely dark ground to register at all.
- **Service Area** (aerial, `DJI_0194`) — a **flat three-stop vertical wash, no horizontal weighting**. Measured over the band the section actually shows, the copy's half and the map's half come out at 0.392 and 0.421 mean luminance: near enough identical, so there is no bright side to lean against. The only real variation is vertical — the middle third (0.439, the roof) against the top and bottom (0.363 / 0.355) — which is what the centre stop answers.

The Service Area's `0.74` is solved rather than picked: against `--stone` it clears 5.9:1 on a bright patch and 4.8:1 on a specular one. The aerial is a much darker frame than the interior (0.386 mean overall), so it needs *less* cover, and gets to stay legible as an aerial.

Below 860px both drop to one flat wash — stacked, the copy runs full-width over whatever a narrow vertical slice of the frame happens to contain, with no side to favour.

Small type over a photo also carries a `text-shadow`, since the ground beneath a given line changes as the layer drifts. The hero h1 is 74px of bold white and holds on its own; everything below that size does not.

### Brass and sage had to move

`--brass` and `--sage` do not survive a photographic ground, and **no scrim fixes it**: `#B8863B` tops out at **4.62:1 even against solid `--lake-deep`**, so pushing the scrim to 0.94 still only reached 4.40:1 while destroying the photo. The colour itself has to move.

So there are two lifted tokens — same hues, raised in lightness, used *only* where type sits on an image:

| Token | Value | Replaces | Used on |
|---|---|---|---|
| `--brass-on-photo` | `#D3A55C` | `--brass` `#B8863B` | hero eyebrow + `24–48HR`, Service Area eyebrow, the map's Reno dot |
| `--sage-on-photo` | `#A6BCC3` | `--sage` `#7F9AA3` | hero badge caption, scroll cue |

Measured against the ground beneath the actual text (Range boxes, not the block's full width — the eyebrow's ink is 101px of a 528px block, and sits on a brighter patch than the block average):

| Element | Base token | Lifted |
|---|---|---|
| Hero eyebrow | 2.88:1 | **4.12:1** |
| Hero badge caption | 3.23:1 | **4.86:1** |
| Service Area eyebrow | 2.79:1 | **3.99:1** |

Those land near the 4.62:1 / 5.01:1 the base tokens get on a flat `--lake-deep` section, which is the bar — not perfection, but parity with the rest of the site. Everything else already cleared comfortably: h2 at 9.9:1, lede at 8.1:1, map labels at 8.7:1.

**Flat sections keep the base tokens.** `.services`, `.pricing`, `.contact` and the footer are untouched. The lifted rules are scoped under `.hero` / `.area` — note that `.hero .turn-badge .num` needs that `.hero` prefix to outrank the base `.turn-badge .num`, which is equal specificity and later in the file.

### The hero's linework

The hero's contour field is kept, and it has to clear the scrim — under it, hairlines at 0.08 opacity are simply gone. It is a real element rather than a pseudo, so it needs an explicit `z-index` to outrank `::after`, which is generated last and would otherwise paint over it. The stack is **photo (0) → scrim (1) → linework (2) → copy (3)**, all four set explicitly.

### The background asset

Each background is **two exports**, swapped by viewport width rather than by DPR — what a full-bleed background runs short of is CSS pixels across, not device pixels. A 1600px file is fine inside a half-width panel but is upscaled past its own width across a 1920px viewport and goes visibly soft.

| Section | ≤860px | 861–1099px | ≥1100px |
|---|---|---|---|
| Hero | `DSC08587.jpg` 1600px, 248 KB | ← same | `DSC08587-2560.jpg` 2560px, 524 KB |
| Service Area | `DJI_0194-portrait-1200.jpg` **portrait**, 368 KB | `DJI_0194.jpg` 1600px, 296 KB | `DJI_0194-2200.jpg` 2200px, 516 KB |

**Backgrounds use a different export recipe from gallery photos: bigger, and at a lower quality.** The gallery pipeline is 1600px at q82; these are 2200–2560px at q70–80. Lower quality is not a compromise here — a 0.74+ scrim compresses the tonal range enough that JPEG artifacts stop being visible. Compared side by side under the scrim, q78 and q66 of the aerial were indistinguishable, so it ships at q70 and saves ~320 KB against a q80 export of the same pixels.

The aerial needs that headroom more than the interior did: it is dense high-frequency detail (shingles, gravel, foliage) and compresses badly — at q80/2560 it was 836 KB, against 524 KB for the interior at the same settings. 2200px rather than 2560px for the same reason; it still clears a 1920px viewport.

`DJI_0194.jpg` was already in `optimized-assets/` as an unused gallery export and has been re-encoded to the background recipe. It is not referenced anywhere else — check before reusing it in the mosaic, where it would now be below pipeline quality.

The hero's pair is additionally preloaded from `<head>`, media-matched to the same 1100px breakpoint, because a CSS background is only discovered once the stylesheet has parsed — too late for something above the fold. **Those hints have to be kept in step with the CSS**; a stale preload silently fetches an image nothing uses and leaves the real one late.

### Stacked layouts want a different frame, not a smaller file

A landscape photo behind a tall narrow section is brutally cropped on a phone. At 390px wide the section is ~970px tall, `cover` is height-limited, and only about **a fifth** of the frame's width survives — which for the aerial was roof and nothing else.

The Service Area answers that with a genuinely different frame below 860px: the same photograph **rotated 90° left into portrait**, uncropped. Because the frame now roughly matches the section, ~46% of its width shows instead of ~20%, and the whole property reads rather than a single roof.

```bash
magick DJI_0194.jpg -auto-orient -rotate -90 \
  -resize 1200x -strip -interlace Plane -sampling-factor 4:2:0 -quality 70 \
  ../web/public/optimized-assets/DJI_0194-portrait-1200.jpg
```

**Where the subject sits decides what the parallax reveals.** Scrolling down translates the layer down, which walks the visible window *up* through the image — so whatever is near the top arrives last. Uncropped, the patio sits ~63% down, which means it is on screen from the start and the **roof** is what comes into view.

A tighter crop was built and rejected: cropping to the patio and placing it ~38% down made the patio the payoff instead, but lost the house entirely and read as landscaping rather than a property. Showing the whole property won. Worth knowing before re-cropping this image — the reveal follows from where the subject lands, so a new crop needs that checked.

Two things that follow:

- **The breakpoint is 860px, matching `.area-inner`'s**, so the frame changes exactly when the layout does. It is deliberately not the 1100px used for the size swap — those two breakpoints answer different questions (*which shape* vs *how many pixels*).
- **1200px wide, 368 KB** against the 296 KB landscape file it replaces. About 1.4× for a 390px phone rather than a full 2×, which is fine under a 0.82 scrim on a handset.

The hero is still landscape at every width, so it keeps this problem: at 390px it is ~987px tall and crops the same way. Giving it the same treatment is open work — it just needs a portrait crop worth looking at.

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
2. Resize and recompress with ImageMagick into `web/public/optimized-assets/`:

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
       "../web/public/optimized-assets/$out"
   done
   ```

   Settings: max 1600px on the long edge (still crisp on retina), JPEG quality 82, EXIF stripped, progressive encoding so images render top-to-bottom as they download.

   Give the output a URL-safe name — no spaces. The loop above pipes filenames through `tr ' ' '-'` for that reason, so `drone twilight.jpg` in `assets/` lands as `drone-twilight.jpg` in `optimized-assets/`.

3. Reference the new file from `index.html` using a path like `optimized-assets/your-photo.jpg`.

`optimized-assets/` holds **only what the page actually references** — twelve exports from eight photographs, ~3.9 MB. Anything not reachable from `index.html` or `styles.css` gets deleted rather than left lying around; the full-resolution originals stay in the project-root `assets/`, so a dropped export is one `magick` command away from coming back. (`DSC00171` and `DSC09181` were pruned this way — shot, exported, never placed.)

A phone pulls roughly **2.2 MB** of that and a wide desktop **2.5 MB**, the difference being which backdrop pair each takes. That is a lot, and it is a deliberate call for a photography studio: the imagery is the product. The backgrounds are where to claw it back if it ever needs to be — see the export recipe above.

### Regenerating the icons

The favicon set and link-preview image are generated from the brand mark — the same ridgeline polyline used in the nav — with ImageMagick draw primitives rather than the SVG source, because ImageMagick's built-in SVG renderer silently drops `stroke` on unfilled paths:

```bash
magick -size 512x512 xc:'#14293A' \
  -fill none -stroke '#B8863B' -strokewidth 40 \
  -draw "stroke-linejoin round stroke-linecap round polyline 56,365 165,183 238,292 310,147 456,365" \
  mark512.png

magick mark512.png -resize 180x180 -background '#14293A' -alpha remove -depth 8 -strip web/public/apple-touch-icon.png
magick mark512.png \
  \( -clone 0 -resize 48x48 \) \( -clone 0 -resize 32x32 \) \( -clone 0 -resize 16x16 \) \
  -delete 0 web/public/favicon.ico
```

`og-image.png` is the same mark at 1200×1200 with the wordmark set in Georgia Bold beneath it — a stand-in for Fraunces, which isn't installed locally. If Fraunces is ever installed, point `-font` at it and regenerate for an exact match with the site's headings.

## Inquiry form

The form in **Get In Touch** posts to `/api/inquiry` in [`worker.js`](web/worker.js), which emails the submission to `mtnpinemedia@gmail.com` **via [Resend](https://resend.com)**. The reply-to is set to the agent, so hitting reply in the inbox reaches them directly. It replaced a `mailto:` draft, which depended on the visitor having a mail client set up and left nothing sent until they finished the job in it.

It is a port of Lake & Pine's review form, and the guardrails are the same code. What differs:

- **Name and email are required**, where the review form needs only a star rating. An inquiry nobody can answer is no use, and the email becomes `reply_to`. The Worker checks both again and answers `400`.
- **Validation is the browser's own.** The review form is `novalidate` because its star inputs are visually hidden and `reportValidity()` can't anchor a bubble to them. Every required field here is a visible input, so the native bubble works and there's nothing to hand-roll.
- **Turnstile loads on approach, not with the page.** The review form is a page of its own; this form is the last thing on a long homepage most visitors never reach. The widget runs a challenge the moment it renders, so it is rendered explicitly once the form comes within 600px of the viewport, or the moment anything in the form takes focus. The script is never requested by a visitor who doesn't scroll that far.
- **A link in the notes is not flagged.** Lake & Pine marks reviews containing a URL as possible spam; an agent pasting the Zillow or MLS page for the listing is an ordinary inquiry, so here that heuristic would mostly flag real business.

A few details worth keeping:

- **The form requires JavaScript.** Turnstile is a scripted challenge, and a no-JS path that skipped it would be precisely the door bots use. `<noscript>` hides the form and offers the email address instead.
- **`.form[hidden]` needs its own rule.** `display:flex` beats the user-agent's `[hidden]{display:none}`, so without it the filled-in form stays on screen behind the thanks message.
- **The widget picks its size when it renders.** `flexible` fills the column but bottoms out at 300px, and on a 320px phone the column is 280px, so below 300px it renders `compact` (150×140) instead. Measured at 390px: a 350px widget in a 350px column; at 320px: compact, inside the column, no horizontal scroll.
- **If Turnstile's script is blocked** — a privacy extension, a network filter — the form can never get a token. The status line says so straight away and gives the email address, rather than letting someone type everything out first.
- **The error colour is `#E39A87`, not a palette token.** Brass reads as the accent rather than a problem; this coral holds 6.6:1 against `--lake-deep`.

### Spam filtering

Four checks stand in front of the send, ordered cheapest first so a flood costs as little as possible. Only the last spends a network round trip.

| # | Check | Rejects with |
|---|---|---|
| 1 | **Same-origin.** `Origin` must equal the Worker's own origin. Trivially forgeable by anything that isn't a browser — that's the point, it costs nothing and drops drive-by scripted posts. `ALLOWED_ORIGINS` extends it if the page is ever served from another hostname. | `403` |
| 2 | **Rate limit.** Native Workers binding, 5 requests per 60s per IP. | `429` |
| 3 | **Honeypot.** An off-screen `website` field — positioned off-screen rather than `display:none`, which the cruder bots check for. Filling it returns `200` and silently drops the submission; telling a bot it was caught only helps it. | `200` (lie) |
| 4 | **[Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/).** Verified server-side against `siteverify`. | `403` |

The rate limiter's `period` accepts only 10 or 60 seconds, so it is a flood stop rather than a daily cap. Counters are shared per `namespace_id` across the whole Cloudflare account, and Lake & Pine's limiter already uses `1001` — this one is `1002`, and the two must stay different if both Workers ever share an account.

**Turnstile pins `action` and `hostname`, not just `success`.** A bare `success` check accepts any valid token, including one farmed from a widget on someone else's page and replayed here. `action` must match `TURNSTILE_ACTION` in `worker.js` and `data-action` on the widget — **change one and you must change the other**, or every submission is rejected.

**Tokens are single-use and expire after 300 seconds.** The widget refreshes itself (`refresh-expired: 'auto'`), and the page calls `turnstile.reset()` after a failed submit so a retry doesn't spend an already-spent token. The page also refuses to post at all until a token exists, because a submission without one is a guaranteed `403` and the agent isn't at fault.

**A missing `TURNSTILE_SECRET_KEY` fails closed** with a `500`, like a missing Resend key. Spam protection that switches itself off when its configuration goes missing is the one failure mode worth refusing outright.

Verified under `wrangler dev`, in order: no `Origin` → `403`; a foreign `Origin` → `403`; honeypot filled → `200` with nothing sent; no name and a malformed email → `400`; valid but no token → `403`; valid with the dummy token → through Turnstile to `500` (no Resend key locally); malformed JSON → `400`; the sixth request inside a minute → `429`.

#### The testing keys, and the trap in them

Cloudflare publishes dummy keys, and `web/.dev.vars` uses the always-passing secret so `wrangler dev` runs with no real credentials:

| | Sitekey (public, in the HTML) | Secret (in `.dev.vars`) |
|---|---|---|
| always passes | `1x00000000000000000000AA` | `1x0000000000000000000000000000000AA` |
| always blocks | `2x00000000000000000000AB` | `2x0000000000000000000000000000000AA` |

Dummy secrets answer with `hostname: "example.com"` and **no `action` field at all**, so pinning either would reject every local submission. `worker.js` therefore skips those two checks when the configured secret is one of the documented testing values — decided from the secret rather than from the response, so what comes back over the network can't influence it. This costs nothing in production, where a testing secret would already pass everything regardless.

> **`index.html` currently carries the always-passing *testing* sitekey.** It has to be swapped for the live one before this ships — step 1 of [First deploy](#first-deploy-of-the-inquiry-form). If you ever see a red *"For testing only. If seen, report to site owner"* bar under the widget on the live site, the testing sitekey is in the page, and every submission will be failing at verify time.
>
> **Keep the dummy secret in `web/.dev.vars`, not the real one.** The live widget won't issue a valid token on `localhost`, and the Worker only skips action/hostname pinning for the documented testing secrets — so a real secret locally means every `wrangler dev` submission `403`s. The endpoint itself can always be exercised with `curl` and the dummy token `XXXX.DUMMY.TOKEN.XXXX`. To drive the real widget in a browser, add `localhost` to its hostname list in the dashboard, put the real secret in `.dev.vars`, and browse at `localhost:8787` rather than `127.0.0.1` — hostname pinning compares against the address you used. Swapping the testing sitekey back into the page for local work also works, but it is exactly the change that gets committed by accident.

### The notification email

The template lives in [`web/email.js`](web/email.js), imported by both `worker.js` and the preview script so a preview can never drift from what actually sends. Resend gets `text` and `html` together and the client picks one.

**Preview it without sending anything:**

```bash
cd web
node preview-email.mjs --open     # renders four cases to web/.email-preview/ (gitignored)
```

It leads with the listing, because that's what decides whether and when the shoot happens, then the notes, then who it's from. The subject keeps the shape the old `mailto:` draft used — `Shoot inquiry — <listing>` — and adds the agent's name in brackets, since every inquiry now arrives from the same sender address and the inbox would otherwise show nothing to tell them apart.

Email is not the web, and three constraints shape the HTML:

- **Google Fonts do not load.** Gmail strips the `<link>` and Outlook ignores it. The serif falls back to Georgia and the mono to the system monospace stack.
- **Styles are inline and the layout is tables.** Several clients drop `<style>` blocks, and desktop Outlook renders with Word's engine, which has no usable flexbox or grid.
- **The inner table needs `table-layout: fixed`.** Tables size to their content, so a single long unbroken line stretches the email past its 600px max-width.

Everything the agent typed is HTML-escaped; the `escaping-and-link` preview case keeps a literal `<em>` and an ampersand in the notes and the name so that stays covered. Line breaks in the notes are kept.

### Email authentication (SPF, DKIM, DMARC)

As of October 2026, `mountain-pine-media.com` is set up as a domain that sends **no mail at all**. Its DNS is on Cloudflare:

| Record | Value |
|---|---|
| `MX` | *(none)* |
| `TXT` @ apex | `v=spf1 -all` — no server is authorised to send |
| `TXT` @ `_dmarc` | `v=DMARC1; p=reject; sp=reject; adkim=s; aspf=s` — reject anything that fails, strict alignment |

Resend changes that, and its dashboard gives the exact records to add. Expect a DKIM `TXT` at `resend._domainkey`, plus an `MX` and an SPF `TXT` on the `send` subdomain, which Resend uses as the envelope sender for bounces. **Leave the apex SPF and the DMARC record as they are.** The apex SPF never sees Resend's mail, since the envelope sender is `send.mountain-pine-media.com`, and the strict DMARC policy is good protection against anyone spoofing the domain.

What this means in practice: DMARC passes when *either* SPF or DKIM aligns, and with `aspf=s` SPF never can — `send.mountain-pine-media.com` isn't an exact match for the `From` domain. **The `resend._domainkey` record is the only thing making inquiry emails DMARC-compliant**, and under `p=reject` a failure is not a trip to the spam folder: Gmail refuses the message outright. The Worker would still have had a `200` from Resend, so the agent sees the thanks message and the inquiry is silently gone; only Resend's dashboard would show the bounce. Never delete that record while tidying DNS.

Verifying, including straight from the authoritative nameservers when a local resolver has a stale negative cache:

```bash
dig +short TXT resend._domainkey.mountain-pine-media.com
dig +short TXT _dmarc.mountain-pine-media.com
dig +short @"$(dig +short NS mountain-pine-media.com | head -1)" TXT resend._domainkey.mountain-pine-media.com
```

## SEO & link previews

The `<head>` includes Open Graph and Twitter Card meta tags pointing at `og-image.png` (the company logo, 1200×1200), so the site renders a proper preview card when shared via iMessage, Slack, Twitter, Discord, etc.

Alongside those:

- **`ProfessionalService` JSON-LD** describing the studio, its service area (Reno, Sparks, Carson City, Minden, Gardnerville, Fernley, Incline Village, Truckee, Washoe County, Northern Nevada), and the five services offered.
- **Canonical link** and a meta description.
- **`robots.txt`** allowing all crawlers and pointing at **`sitemap.xml`**. The sitemap has a single URL and a hardcoded `lastmod` — bump it when the content changes meaningfully.

Note that the biggest remaining wins for search visibility are off-site: a Google Business Profile and Search Console verification.

The domain `mountain-pine-media.com` is hardcoded in six places — the `<head>` meta block and JSON-LD in `index.html`, `robots.txt`, `sitemap.xml`, the default sender in `worker.js`, and the footer line in `email.js`. Change them together if it ever moves, and add the new hostname to the Turnstile widget and to Resend as well.
