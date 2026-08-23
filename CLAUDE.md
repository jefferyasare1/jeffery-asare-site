# Jeff's Writing Preferences

## Style
- No em dashes (—) ever. Use a comma, period, or rewrite the sentence instead.
- Tone: conversational, like talking to a friend. Not literary or over-polished.
- Short sentences. Let the story breathe.
- Keep the natural energy of how he tells things — don't over-clean it.

---

# Project Memory — jeffery-asare-site

Read this file at the start of any session touching this repo, before making changes.
It exists so nothing below gets lost when a conversation gets compacted or a new
session starts cold. Keep it updated as things change; don't let it go stale.

## Repo basics
- GitHub: `jefferyasare1/jeffery-asare-site` — Cloudflare Pages, vanilla HTML/CSS/JS,
  no framework. Live site: jefferyasare.com.
- Main files: `index.html` (public SPA — portfolio, shop, print detail, room preview),
  `dashboard.html` (admin CMS), `_data/prints.json` (shop catalog), `functions/api/*.js`
  (Cloudflare Pages Functions).

## Environment quirks — always true, don't rediscover these
- **Cloud sandbox git push is blocked.** The git proxy refuses pushes to this repo
  ("not in this session's authorized repository set") — tried repeatedly, never
  resolved. Don't waste time retrying `git push` from the cloud sandbox. Instead:
  edit files in the sandbox clone, then deliver via the device bridge (below).
- **Delivery pattern to Jeff's Mac:** `SendUserFile` on the changed file(s), then
  `mcp__remote-devices__device_commit_files` to write them into
  `/Users/jeffasare/Documents/GitHub/jeffery-asare-site` (the connected folder).
  Then `git add`/`git commit` there via `device_bash` (see lock workaround below).
  Jeff does the actual `git push` himself via GitHub Desktop — the cloud sandbox
  cannot push directly.
- **Git lock file bug on Jeff's Mac mount:** `unlink()` on any `.git/*.lock` file
  fails with "Operation not permitted" via the device bridge (a mount permission
  restriction), so a stale lock blocks the next git command with
  "fatal: Unable to create '.../index.lock': File exists." The git operation itself
  usually still succeeds despite the unlink warning — it's noise, not a real failure.
  Fix: rename, don't delete, immediately before every git command:
  `mv .git/index.lock .git/index.lock.bakN 2>/dev/null; mv .git/HEAD.lock .git/HEAD.lock.bakN 2>/dev/null; true`
  chained in the same shell call as the real git command. Expect to do this before
  nearly every `git status`/`add`/`commit` call on his machine.
- **`device_bash` cannot delete files** on Jeff's Mac (`rm`/`unlink` → "Operation not
  permitted"). Use `mv` into a `_to_delete/` subfolder instead and tell Jeff to
  delete it himself, or just rename `.lock` files as above.
- **Secrets — never re-commit these:** `PROJECT_HANDOFF.md` and `commit_helper.html`
  both contain live credentials (a GitHub PAT, a CMS key, a Cloudflare account ID).
  Both are in `.gitignore` on Jeff's local repo already. If either shows up as
  trackable again, re-add to `.gitignore` and `git rm --cached` before committing
  anything else — don't let a commit go out with them in it.

## Feature: "See it in a room" (content-aware compositing)
- `functions/api/compose-room.js` — GET endpoint, takes `room`/`print`/`size` query
  params, uses Gemini image-editing API to composite a framed print onto a room
  photo (replaced an old fixed-CSS-overlay approach).
- Loading same-zone static assets (print photos, room backgrounds) inside a Pages
  Function **must** go through `env.ASSETS.fetch(new Request(url))`, never a raw
  `fetch(url)` — a raw fetch back to the same zone's public hostname 502s at the
  edge with no catchable error. This was already fixed and confirmed live/working
  (Cloudflare real-time function logs showed `outcome: "ok"`, no exceptions).
- `GEMINI_ATTEMPTS` list order matters: `gemini-2.5-flash-image` (stable GA, more
  generous quota) now goes **first**, `gemini-3.1-flash-image` (newer preview model,
  much tighter free-tier quota) is the fallback. It was the other way around
  originally, which meant every request burned its first attempt on the model most
  likely to 429. Real-time logs confirmed the actual failure was Gemini returning
  HTTP 429 "quota exceeded", not a code bug — the client's generic "Preview
  unavailable right now" message is just what shows whenever `d.image` is missing
  from the JSON response, whatever the underlying cause.
- **CONFIRMED (2026-08-21) via live Cloudflare real-time logs:** the model
  reorder is deployed and working exactly as intended (2.5 is tried before 3.1),
  but ALL FOUR attempts still fail with the same `429 "You exceeded your current
  quota"` error — every model, both API versions. This rules out a model-specific
  quota; the whole `GEMINI_API_KEY` (used by both compose-room.js and
  generate-room.js) is out of quota/billing on the Google side. Reordering
  models cannot fix this — it needs Jeff to check quota/billing for that exact
  key at https://ai.dev/rate-limit or Google Cloud Console, and likely enable a
  paid tier (image generation is not realistically usable on the free tier at
  any real traffic). Don't spend more time on code-side retries/fallback-order
  tweaks for this specific symptom until that's addressed on his end.
- **CONFIRMED (2026-08-21): Cloudflare replaces the response body of any 5xx
  status returned by a Pages Function with its own generic branded "Bad
  Gateway" HTML page** — the Worker itself completes fine (`outcome: "ok"`, no
  exceptions) and returns real JSON, but the browser never sees it once the
  status is 5xx. Fixed by changing every failure path in compose-room.js
  (`GEMINI_API_KEY not configured`, `Could not load source images`, `Image
  compositing failed`) to return **200** with `{error: ...}` in the body instead
  of 500/502 — the client already only checks for a missing `image` field, not
  the HTTP status, so behavior is unchanged for the user but the real error is
  now inspectable (Network tab, logs) instead of being swallowed. Apply this
  same pattern to any other endpoint here that seems to "hide" its own error
  messages behind a blank Cloudflare error page.
- **RE-CONFIRMED (2026-08-21, later same day, after Jeff reported "unable to
  place the print into the room" post-deploy):** tested live against the
  newest Production deployment (`9ac32cd` / deployment id
  `6dc3b5d4-8a00-421c-a151-4527f983c9a1`, confirmed as current Production via
  the deployments list) by hitting `/api/compose-room` directly in-browser
  with a fresh cache-busting param. Two things confirmed at once: (1) the
  200-status fix IS live — the browser now shows the real JSON error body
  instead of Cloudflare's generic "502 Bad Gateway" page (tab title changed
  from "502: Bad gateway" to a normal title); (2) the underlying failure is
  the exact same Gemini quota issue, unchanged: `{"error":"Image compositing
  failed: v1beta/gemini-3.1-flash-image error 429: ... You exceeded your
  current quota, please check your plan and billing details..."}`. So Jeff's
  fresh bug report is NOT a regression or a new bug — it's the same
  pre-existing Google-side quota exhaustion, just now visible with a real
  error message instead of a dead Cloudflare error page. Nothing to fix in
  code here; still waiting on Jeff to sort out Gemini billing/quota.
- Check Cloudflare Dashboard → Workers & Pages → jeffery-asare-site → latest
  deployment → Functions → Real-time Logs (Beta) → click a log row to expand
  full JSON (request headers, response status, captured console.error calls)
  when this needs live debugging again. The deployments list
  (`/pages/view/jeffery-asare-site`, no deployment ID in the URL) shows what's
  actually in Production right now and whether a given commit ever got deployed
  — Cloudflare auto-deploys on push to `main`, but always verify Production is
  on the expected commit before assuming a pushed fix is live.
- KV cache: bind a KV namespace called `ROOM_CACHE_KV` in the Cloudflare dashboard
  to cache composites per (room, size, print) — already bound and working. Endpoint
  degrades gracefully (just uncached) if it's ever missing.
- Only one room exists (`living`), so the room-selector tab UI was removed — don't
  re-add a "Living room" tag/tab unless a second room background is actually added
  to `ROOM_BACKGROUNDS` in `compose-room.js`.
- **Frame style is now chosen per-print in the dashboard** (Shop tab → edit a
  print → "Frame style" dropdown → `cms-p-frame`, saved as `print.frame` in
  `_data/prints.json`, one of `walnut` (default) / `black` / `white` / `oak`).
  Threaded all the way through: dashboard save → prints.json → client's `PRINTS`
  array (`index.html`, the `d.prints.map(...)` block) → `&frame=` on the
  `/api/compose-room` request → `FRAME_STYLES` lookup in compose-room.js that
  builds the actual frame description into the Gemini prompt. The KV cache key
  includes frame now too, so changing a print's frame in the dashboard doesn't
  serve a stale composite in the old frame. Keep the 4 keys in sync in exactly
  two places if this ever needs a 5th option: `FRAME_OPTIONS` in
  `dashboard.html` (cmsOpenPrintEdit) and `FRAME_STYLES` in `compose-room.js`.

## Recent UI sizing changes (so future edits build on these, not the old values)
- Shop grid (`.shop-list`): 4 columns desktop / 3 tablet (≤900px) / 2 mobile
  (≤580px), was 3/2/1. Smaller cards read sharper at the same source resolution.
- Print detail image column (`.print-detail-grid`): **22% / 1fr** (was 55%, then
  44%, then halved again to 22% on 2026-08-21 — ask before halving again, it's
  getting quite narrow).
- Room preview section (`.pd-room-preview`): **max-width:930px** (was 620px,
  increased 50% on 2026-08-21; originally full-bleed edge to edge before that).

## Ambient background audio (2026-08-21)
Portfolio page has a speaker-icon toggle (`.ambient-toggle`, injected into
`.port-title-row` alongside the dark-room toggle — see the "UTIL BAR" IIFE)
that plays a quiet looping music bed. The button and its click handler
existed before this session; the audio file did not. Jeff supplied
"ES_Summer Memories - Gavin Luke.mp3", confirmed by Jeff as sourced from
Epidemic Sound, and dropped the raw file at the repo root; per his go-ahead, it now lives at
`audio/ambient.mp3` instead — re-encoded 320kbps→112kbps CBR stereo (6.7MB→
2.35MB, same ~168s duration, metadata stripped) since it's a quiet background
bed, not a featured download, no reason to ship it at full bitrate.
Also fixed two real problems in the existing JS (the "AMBIENT MELODY" IIFE,
~line 3759): the target volume was `0.72` (way too loud for background
ambience) and looping used the browser's native `audio.loop=true`, which
cuts hard from full volume straight back to the start every ~2:48, an
audible pop/jump at the seam. Now: target volume is `0.15` (a single
`TARGET_VOL` constant — don't raise it without checking with Jeff first,
"low and not distracting" was the explicit spec), and looping is hand-rolled
via `timeupdate`/`ended` listeners that fade the volume to 0 over the last 3
seconds of the track, let it play into a natural `ended`, then reset to
`currentTime=0` and fade back up to `TARGET_VOL` over 3 seconds. Verified
locally with Playwright, including the loop seam itself (faked `duration`/
`currentTime` and manually dispatched `timeupdate`/`ended` rather than
waiting out the real 168s track) — fade-out reaches exactly 0 without
pausing (so it keeps playing into `ended`), the loop restart correctly
resets position and volume, and the post-loop fade-in lands back on
`TARGET_VOL`. No autoplay: browsers block audio-with-sound until a user
gesture, so this only ever starts on the visitor's own click of the toggle,
by design, not an oversight.

**Music credit (2026-08-21):** the original upload's ID3 tags (read before
the metadata-strip during re-encoding, `title`/`artist`/`composer`/`date` —
see git history for the raw tag dump if this ever needs re-checking) confirm
title "Summer Memories", artist/composer "Gavin Luke", 2019. Jeff gave the
canonical track URL directly (`https://www.epidemicsound.com/music/tracks/
6fa26d41-5766-3bef-a03e-a77eae42e9e9/`) and asked that it override whatever
link might otherwise surface, use that one, not something scraped or
guessed from the filename/tags. Credit is placed in exactly two places, both
generated by JS (`injectFooters()`, ~line 1572) so plain entities are safe
there (innerHTML, not textContent — see the entities gotcha section below):
the Portfolio page's mini-footer (`id==="port"` branch — the one page the
track can actually be heard on) and the About page's full footer
(`#footerTpl`). Deliberately NOT on Shop/Contact/Terms/Privacy/Journal/print-
detail/photo-detail — those mini-footers stay at the plain copyright line,
no reason to repeat a music credit on pages where no music plays. Verified
with Playwright that the credit link (exact URL match) exists only inside
`#port-mini-footer` and `#about-footer`, and nowhere in the other six
mini-footers. If Jeff adds more licensed tracks later, follow the same
pattern: read the real ID3 tags before stripping them, get the canonical
track URL from him rather than guessing, and scope the credit to whichever
page(s) that track actually plays on.

## Shop/portfolio grid image clarity vs. anti-theft canvas protection (2026-08-21)
`index.html`'s "IMAGE PROTECTION" IIFE (~line 4019) replaces every `<img>` inside
`#photoGrid` and `#shopList` with a `<canvas>` (right-click/drag blocked, no
`src` attribute for a casual "view source"/Pinterest scrape) — see that whole
section before touching grid image rendering. The grid-thumbnail path (not the
lightbox/detail path, which has its own separate flicker+steganography
treatment) had a real bug: it sized the canvas's internal pixel buffer to only
`0.65 *` the CSS display size and **never accounted for `devicePixelRatio`
at all**. On a standard 1x monitor that's merely soft; on any Retina/hi-DPI
screen (Jeff's Mac, any modern iPhone, most 4K monitors) the canvas buffer was
rendering at *below* one physical pixel per CSS pixel, i.e. genuinely
lower-than-native resolution, which is why Jeff reported the shop catalog
images looking unclear. Fixed by rendering the canvas buffer at
`dispSize * 0.92 * min(devicePixelRatio, 2)` instead — the `min(...,2)` cap
keeps canvas memory sane on 3x mobile displays, and 0.92 (not 1.0) keeps this
a genuine re-render rather than a byte-identical copy, so the "it's a canvas
snapshot, not the source file" protection framing still holds. Nothing else
about the protection changed: same canvas swap, same blocked
contextmenu/dragstart, same `data-pin-nopin`/`data-prot` attributes. Verified
locally via Playwright at both `deviceScaleFactor:1` and `:2` — canvas
buffer-to-CSS-size ratio came out to 0.92 and 1.84 respectively (was a flat
0.65 before, meaning it used to get *more* under-resolved the higher the
screen's pixel density, which is backwards). If clarity ever needs another
notch, raise `RES_FACTOR` in that block — it's a single named constant now,
not a magic number buried in the width/height lines.

## Closure-scoping gotcha — READ THIS before adding any new inline onclick=""
`index.html`'s whole SPA (navigate, bind, openPrintDetail, renderShop, setCurrency,
etc.) is defined inside one big `document.addEventListener("DOMContentLoaded",
function(){ ... })` closure (starts ~line 1427), **not the true global scope**.
Functions declared in there are NOT automatically `window.X` — inline
`onclick="someFunction(...)"` attributes in raw HTML run in true global scope and
need `window.someFunction` to exist, but internal `addEventListener(...)`
callbacks (like `bind()`) resolve the function via normal closure lookup and work
fine either way. This bit us twice already:
- **Found and fixed (2026-08-21):** `window.navigate = navigate;` was missing
  entirely — only two *wrapping* reassignments existed further down ("Surprise
  Me" and "Page Sweep Transition" IIFEs, both doing `var _orig = window.navigate;
  window.navigate = function(){ ...; _orig(...); }`), both silently assuming
  something upstream had already exposed it. Since nothing did, `window.navigate`
  ended up a real function that just silently did nothing useful — no thrown
  error, so it was invisible in the console. This broke the inline
  `onclick="navigate('terms')"` Terms of Sale link on the print-detail page (the
  only place in the whole file that calls `navigate` via inline onclick instead
  of `bind()`). Fixed by adding `window.navigate = navigate;` right after the
  function declaration (~line 1522), before the wrapper wave crashes. Currency's
  `onclick="setCurrency(...)"` on the shop toggle LOOKS like the same bug but
  isn't — there's already a defensive IIFE right after `setCurrency`'s
  declaration (~line 3223) that does `btn.removeAttribute('onclick');
  btn.addEventListener('click', ...)` to route around exactly this trap. If a
  new inline onclick="someClosureFunction(...)" ever gets added anywhere, either
  expose it the same way (`window.fn = fn;` right after its declaration) or wire
  it via `addEventListener` like the currency toggle — don't assume inline
  onclick "just works" for anything defined in this closure.
- **Found and fixed (2026-08-21): Size guide, and the "in N collections"
  collectors counter, were both silently dead** because they're both crammed
  into the SAME `setTimeout(function(){ ... }, 250)` callback as the "You might
  also like" related-prints renderer in `openPrintDetail()`, textually AFTER an
  `if(!picks.length){ ...; return; }` early-return. With only one print in the
  shop, `picks.length` is always 0 (nothing to recommend besides the print
  you're already looking at), so that `return` fired on every single
  `openPrintDetail()` call and skipped everything after it in that callback —
  size guide and collectors counter included, even though neither has anything
  to do with related prints. Fixed by wrapping just the "You might also like"
  block in its own `(function(){ ... })();` so its `return` only exits itself.
  **This will look "fixed on its own" the moment a second print gets added to
  the shop** (since `picks.length` would then be nonzero) — that's a red herring;
  the actual bug was the missing scope boundary, not the print count, and it
  would resurface any time related-picks is legitimately empty again (e.g. every
  print momentarily belongs to a series of one). The IIFE wrap is the real fix,
  not the print count.

## HTML entities in `.textContent` — READ THIS before adding any new one
`&#NNNN;`-style numeric HTML entities only decode when the browser's HTML
*parser* sees them (raw markup, or a string assigned to `.innerHTML`).
`.textContent = '...'` sets a raw text node and never runs the HTML parser on
it, so an entity inside a textContent string shows up on the page **literally**,
character for character (e.g. `&#9200; Typically within 24 hours` — this is
the exact bug Jeff reported on 2026-08-21). Found and fixed 4 occurrences, all
in `index.html`, all now using the real Unicode character directly in the JS
string instead of an entity:
- `contactResponse` element, set from the CMS's `contact_response` setting
  (~line 4268, was `&#9200;` → now `⏰`) — this was the one Jeff actually saw,
  since it only fires when `/_data/settings/contact-info.json` has a
  `contact_response` value, overwriting the (correctly-entity-encoded, because
  it's raw HTML) static fallback text sitting in the markup at line 1223.
- Newsletter signup success state (~line 2309, `&#10003;` → `✓`)
- Review submit success state (~line 2407, `&#10003;` → `✓`)
- Certificate-of-authenticity download button (~line 3640, `&#10003;` → `✓`)
Grepped the whole file afterward for any other `textContent\s*=` assignment
containing `&#`/`&amp;`/`&nbsp;`/etc — none left, and none in dashboard.html /
admin.html / central-admin.html / thank-you.html / prints/index.html either.
**When adding a new one-off UI symbol (checkmark, arrow, emoji, etc.) via JS:**
if it's going into `.textContent`, use the literal Unicode character (or a
`\uXXXX` JS escape) directly in the string — never an HTML entity. Entities are
only safe inside literal `<tag>...</tag>` markup or a string assigned to
`.innerHTML`, both of which the many other `&#8594;`/`&#9733;`/etc. usages in
this file correctly are (that's why only these 4 were broken and not all of
them).

## Shop catalog
- `_data/prints.json` currently has exactly one print ("The Herdsman", RANDOM-STORIES
  series). Jeff has mentioned wanting more prints in the shop — don't fabricate
  titles/descriptions/prices for new prints on his behalf; ask him for the real
  content (image, title, series, edition size, description, sizes/prices) first.

## Testing locally before shipping (cloud sandbox has no network to the real CDNs)
`wrangler pages dev .` (via `npx`) serves the full site including `/functions/*`
from the sandbox clone — no need to wait for a real deploy to test client JS,
CSS, or Function request/response logic (Gemini calls will fail for lack of a
real key, but everything up to that point — validation, prompt building, error
shapes — is fully testable). Drive it with Playwright
(`/opt/pw-browsers/chromium-1194/chrome-linux/chrome`, already installed) rather
than eyeballing it — this repo's JS has real, non-obvious closure-scoping bugs
(see above) that only show up by actually clicking things and reading return
values, not by reading the source. **Important:** the sandbox cannot reach
`cdn.jsdelivr.net`, `cdnjs.cloudflare.com`, `js.paystack.co`, or
`static.cloudflareinsights.com` at all (curl to any of them times out), so
emailjs/gsap/paystack/html2canvas/jspdf will be `undefined` and one of them
(`emailjs.init()`, unguarded at top level) throws and kills the rest of that
script tag — this is a sandbox-only artifact, not a real bug, but it produces
a misleading cascade of "everything is broken" symptoms if you don't route
around it. Use Playwright's `page.route()` to serve minimal stub scripts for
those four CDN URLs before navigating (defines just enough of `window.emailjs`
/ `window.gsap` / etc. to let the real app code run without crashing) — a
working version of these stubs was built and used successfully in this session;
recreate the same pattern rather than testing against the raw crash.

## Mobile scroll smoothness, back-button, footer layout, and refresh-crash fixes (2026-08-22)
Jeff reported a batch of 5 issues in one message. All 5 fixed and verified via
Playwright + wrangler dev before delivery.

**1. Janky scroll on phone, "slams" at the bottom.**
Two separate causes, both fixed:
- `html{scroll-behavior:smooth}` was global. Smooth-scroll and native touch
  momentum/rubber-banding fight each other on iOS/Android — that fight is what
  produces the "slam" at the top/bottom of the page. Fixed by scoping smooth
  scroll to non-touch input only: `@media (pointer:coarse){ html{scroll-behavior:auto} }`.
  Verified via Playwright device emulation (`devices['iPhone 13']` → `auto`,
  desktop viewport → `smooth`).
- The portfolio/shop parallax RAF loop (`PORTFOLIO + POTW PARALLAX` IIFE) was
  running a full `document.querySelectorAll` + per-card `.style.transform`
  write on *every single animation frame*, for every card on the page (up to
  ~87 on Portfolio). Throttled the expensive `refresh()` (element re-query) to
  run every 12th frame instead of every frame, and added an epsilon-based
  (`0.02`) skip so a card's `.style.transform` is only actually written when
  its computed value changed meaningfully — cheap on desktop, but this was
  real, measurable jank on mobile GPUs. The very first transform write per
  card is still forced unconditionally (skipping only on later frames) so
  there's no regression in initial paint.

**2. Memory leak in the same parallax system.**
Found while fixing #1, and very likely a contributor to #5 (see below): the
`cards[]` array the parallax loop tracks was only ever appended to, never
pruned. `renderShop`/`renderPortfolio` rebuild their grids via `innerHTML` on
every visit, which detaches the old DOM nodes — but the old references stayed
alive in `cards[]` forever, so repeated Shop↔Portfolio navigation grew the
array unbounded. Fixed with `cards = cards.filter(s => s.el.isConnected)` at
the top of `refresh()`. Verified with a debug-instrumented copy of the file
(exposing `cards.length` via `window.__pxDebug()`): stayed correctly bounded
at 88 (matching real DOM count) across 6 repeated navigation round-trips.

**3. Grid-protection canvases were decoding every image on page load, eagerly,
all at once — defeating `loading="lazy"` and very likely the real cause of #5.**
This was the most involved investigation of the batch. The anti-theft system
(`_protectGridImg`, "Grid protection" block) swaps every `<img>` for a
`<canvas>` and redraws the photo into it — but to do that redraw it was
creating a brand-new `Image()` and setting `.src` on it *immediately* for
every card the instant the grid rendered. The `<img>` tags themselves
correctly have `loading="lazy"`, but that hint is meaningless once the image
has already been swapped out and a fresh, eager fetch kicked off in JS — so
Portfolio (which can have 80+ cards) was decoding 80+ full-resolution photos
into memory on every single page load, whether or not the user ever scrolled
that far. That's a lot of simultaneous full-res decodes for a phone browser
to hold, and refreshing repeatedly (issue #5) compounds it further before the
previous page's memory is even reliably reclaimed. Fixed by gating the actual
`draw()` call behind a per-canvas `IntersectionObserver` (`rootMargin:'600px
0px'`, so decoding starts a bit before a card is actually on screen, not
exactly when it crosses into view) — the cheap part (swapping `<img>` for
`<canvas>`) still happens immediately, only the expensive part (fetch +
decode + render) is deferred. Falls back to the old eager behavior if
`IntersectionObserver` isn't supported.
  - **Verification note for future reference:** an unset `<canvas>` element
    defaults to `width=300,height=150` per spec — so `canvas.width > 0` looks
    true for a canvas that has *never* been drawn, not just for one that has.
    An early verification pass checked exactly that and got a false "PASS"
    (looked like all 87 canvases were already drawn on load). Fixed by
    explicitly zeroing `cv.width=0;cv.height=0;` right when the canvas is
    created, so `width>0` becomes a trustworthy "has this actually been
    drawn" signal both for future debugging and structurally (no stale
    default-sized blank canvas sitting around pre-draw). Re-verified
    correctly after that: only 4/87 canvases drawn on initial Portfolio load
    (matching a direct `draw()`-call counter), and a realistic incremental
    scroll-through (20 steps down the page, not an instant jump) results in
    all 87/87 drawn by the time you've scrolled past them.

**4. Terms of Sale / Privacy Policy "back" button always went to a fixed page
(Hero / Shop) instead of wherever you actually came from.**
The back buttons were hardcoded to `navigate('shop')` / `navigate('home')`,
which is a fresh `navigate()` call — not a real "go back". Added an
`_hasInternalNav` flag that's set true the first time `navigate()` pushes a
real history entry, and a `goBack(fallback)` helper: if there's real in-site
navigation history, use `history.back()` (so it returns to the actual
previous page); otherwise (e.g. someone lands directly on `/terms` via a
shared link, with nothing to go back to) fall back to the old fixed
destination. Verified: Contact→Terms→Back returns to Contact; About→Privacy→
Back returns to About; landing directly on `/terms` with no history correctly
falls back to Shop.

**5. Successive refreshes crashing the page, especially on phone.**
No single reproducible "crash" was captured directly (that's genuinely hard
to force from a sandboxed headless browser), but #2 (unbounded memory leak)
and #3 (up to 80+ simultaneous full-res image decodes per load) are exactly
the kind of thing that would compound across repeated refreshes on a
memory-constrained mobile browser until it gives up and reloads the tab. Both
are fixed above. If Jeff still sees crashes after this ships, that'd be very
useful signal that something else is going on — worth him noting roughly how
many refreshes it takes and whether it's Safari/Chrome/a specific phone.

**6. Instagram / Contact / Terms of Sale / Privacy links at the bottom of Shop
weren't centered** (they were left-aligned like every other page's mini-footer,
but Jeff wanted Shop's specifically centered). Added a `mini-footer-centered`
modifier class, applied only to `#shop-mini-footer` in `injectFooters()`, and
scoped a couple of small CSS overrides to it. Verified via computed style
(`flex-direction:column; justify-content:center`) and a screenshot.

**7. About page mobile footer: "Work" and "About" link columns stacked
vertically instead of sitting side by side, with Newsletter above them instead
of below.**
Fixed with `grid-template-areas` on the existing footer grid, scoped to the
`max-width:580px` breakpoint only (desktop/tablet layout untouched):
`"brand brand" "work about" "newsletter newsletter"`. Added
`footer-col-{brand,work,about,newsletter}` classes to the footer template's 4
direct children so the areas have something to attach to. Verified via
bounding-box checks at a 390×844 viewport: Work and About share the same
`top`, Newsletter's `top` is below both.

## Splash screen stuck on-screen if GSAP fails to load (2026-08-22)
Found while investigating a report of "mangled characters on POTW after reload,
gone on a second reload" — didn't end up being the same bug (see below), but
this is a real, separate one worth fixing regardless.

The intro splash (`#splash`, the black screen with the stamp/aperture-iris
logo animation on first load) is entirely GSAP-driven: `gsap.set(...)` and
`gsap.timeline()...` ran directly inside the `if(splash&&splashLogo){...}`
block, with the "always dismiss after 3.5s" failsafe timer created *after*
those calls. If the GSAP CDN script (`cdnjs.cloudflare.com/.../gsap.min.js`)
is slow, blocked, or fails outright on a given load — a real risk on a flaky
mobile connection, and this file has hit that exact failure mode with other
CDN scripts before (see the emailjs note below) — `gsap.set(...)` throws a
ReferenceError immediately, which aborted execution before the failsafe timer
was ever created. Result: the splash stays fully opaque, z-index 9999,
`pointer-events:all` — the entire site is invisible and unusable — with no
recovery except the user reloading again (and hoping GSAP loads that time).
Reproduced locally by aborting just the gsap request while stubbing every
other CDN script normally; confirmed via a real browser session (Chrome, via
the desktop bridge) on the live site too — a hard/cache-bypassed reload got
the splash stuck this way at least once, though it's intermittent since it
depends on network timing.

Fixed by restructuring so the failsafe timer is created *first*, before
anything GSAP-dependent, and wrapping the GSAP calls in try/catch — a GSAP
failure now dismisses the splash immediately (not even waiting the 3.5s)
instead of leaving it stuck indefinitely. Verified in isolation (extracted
the exact splash code into a minimal standalone page): with `gsap` undefined,
splash dismisses immediately, no error escapes; with GSAP working normally,
behavior is unchanged (dismisses via the real animation, same as before).

**Investigating the actual "mangled characters" report:** used the desktop
Chrome bridge to load the live production site directly and hard/soft-reload
the Portfolio page repeatedly (7+ times, including cache-bypassed reloads) —
POTW text (`Photo of the Week · Week 34 · 2026`, title, location, description)
rendered correctly every time I could observe it. Also fetched and checked
all 87 photos' title/loc/desc fields directly from `/_data/portfolio/*.json`
for stray HTML entities (the pattern behind a previously-fixed bug) — none
found. Also confirmed via live fingerprint checks that **none of this
session's commits are deployed yet** (not even the earlier DPR/entity fixes),
so whatever Jeff saw was on an older, undiagnosed build. Could not reproduce
the literal "mangled characters" symptom directly — if it recurs after this
batch deploys, a screenshot or the exact text would make it possible to
pin down precisely (candidates not yet ruled out: a font FOUT/glyph-swap
artifact specific to the custom Fontshare typeface on a cold cache, or
something intermittent tied to mobile network timing that a fast desktop
session with Chrome's disk cache warm doesn't reproduce).

## Footer recolor, force-zoom, scroll jank round 2, room preview fallback (2026-08-22)
Four more issues from Jeff in one message.

**1. All footers except Hero now share the About page footer's look (black
bg, white text).** Hero never had a footer to begin with (`injectFooters()`'s
id list never included `"home"`), so no change needed there. Recolored the
shared `.mini-footer` (used by Portfolio/Detail/Shop/Contact/Terms/Privacy/
Print-Detail/Journal) from its old light theme to `var(--ink)` bg / white-ish
text, matching `.site-footer` (the big 4-column About footer). Also gave it a
darkroom (dark-mode toggle) override matching `.site-footer`'s (`#111008`).
On phone, the link row (Instagram/Contact/Terms of Sale/Privacy) now always
centers on its own full-width line for every one of these footers, via a
`.mini-footer-links{flex:1 1 100%;justify-content:center;}` rule at the
existing 580px breakpoint — previously only Shop had this, and it dragged
the copyright text into centering too via a blanket `.mini-footer-centered`
class. That class is gone now; the copyright text keeps its normal left
alignment on every page, including Shop specifically per Jeff's callout.
Desktop layout (copy left / links right, single row) is untouched everywhere.

**2. Force-zoom on focusing form fields, on phone.** Classic iOS Safari (and
some other mobile browser) behavior: it force-zooms the whole page in when a
focused input's *computed* font-size is under 16px, as an accessibility
measure. Every form field on the site (contact form, newsletter signup, cart
checkout name/email, review form, certificate signature, print-detail country
select) was sized for desktop at 12-14px. Fixed with a `@media
(pointer:coarse)` block bumping all of them to 16px on touch devices only —
desktop keeps its original sizing. **Placement matters here**: this has to be
the literal last rule in the stylesheet, after every plain (non-media-query)
rule that sets these same properties — a media query doesn't add specificity,
so if it appears earlier in source order than a later plain rule targeting
the same selector, the plain rule wins the cascade regardless of whether the
media query is active. Learned this the hard way mid-session: an earlier
attempt placed the block near the top of the stylesheet (next to the
existing `scroll-behavior` touch override) and it was silently overridden by
the real `.field-input` etc. rules further down — caught by testing against
a real touch-emulated `getComputedStyle()`, not just eyeballing the CSS.

**3. Mobile scroll jank / "slam" at the bottom — round 2, still a problem
after the round-1 fix.** Worth being honest about why: the round-1 fix
(`scroll-behavior:auto` on `pointer:coarse`) only affects scrolls *triggered
by script* (anchor jumps, `scrollIntoView`, etc.) — it was a real fix for a
real problem, but `scroll-behavior` has never had any effect on native
finger-driven touch scrolling in the first place, so it couldn't have
touched what Jeff is actually describing. Two real fixes this round, both
targeting native-scroll jank directly:
  - The portfolio/shop parallax's `window.addEventListener('scroll', ...)`
    handler was calling `getBoundingClientRect()` (which forces a
    synchronous layout recalculation) for every card on the page — up to 87
    of them — on *every single raw scroll event*. Touch scrolling can fire
    scroll events much more often than the screen even repaints, so this was
    doing dozens of forced layouts per rendered frame during a scroll
    gesture — a direct, measurable source of stutter, independent of the RAF
    loop that was already throttled in an earlier session. Same fix applied
    to a second, unthrottled scroll listener (the nav-bar "scrolled" class
    toggle) for the same reason. Both now gate their work to run at most
    once per animation frame via a pending-flag + `requestAnimationFrame`,
    regardless of how many raw scroll events fire in between.
  - `.potw-editorial` (the big photo-of-the-week block partway down
    Portfolio) was sized with a plain `62vh`/`55vh`. Plain `vh` is measured
    against the browser's *full* viewport including the address bar — and
    mobile browsers resize that address bar as you scroll, especially near
    the bottom of a page, which means a `vh`-sized block actually changes
    height mid-scroll, shoving everything below it up or down without
    warning. That is exactly what a sudden "slam"/"goes up and comes down"
    feels like. Fixed the same way `.hero` already correctly handled this
    (that one was already right): repeat the property with `svh` — measured
    against the *smallest* the viewport ever gets, so it can't move mid-
    scroll — as a progressive enhancement after the plain `vh` value.
    Applied the same `vh`+`svh` pairing to `.detail-hero-ph` (Print Detail
    page) for consistency, same risk.
  - Verified via a simulated rapid-scroll-event burst (40 scroll events
    fired faster than a frame) with no thrown errors, and confirmed the POTW
    block now resolves to a real, stable height. Flagged honestly to Jeff
    that neither of these can be fully confirmed as *the* fix without an
    actual phone — they're both real, well-understood bugs with the classic
    symptom he described, not guesses, but I can't feel the "slam" myself
    from here.

**4. "See it in a room" preview — still the same Gemini quota exhaustion**,
re-confirmed live (fetched `/api/compose-room` directly from the production
site via the Chrome bridge): identical `429 "You exceeded your current
quota"` error, same as the 2026-08-21 diagnosis above. This is not fixable
from the code side — see that section for what Jeff needs to check on the
Google side. What *is* fixable: the failure experience. Previously, a failed
composite showed the bare empty room with an apologetic status message and
nothing else — the print itself was nowhere to be seen. Added a fallback:
on failure, show the plain print image, framed and matted via CSS (frame
color follows the print's own `frame` setting — walnut/black/white/oak),
positioned over the empty wall area of `/images/rooms/living.jpg` (eyeballed
against the actual image, not computed — see `ROOM_FALLBACK_SIZE_PCT`/
`ROOM_FALLBACK_FRAME_COLOR` and the `.pd-room-fallback*` CSS), sized roughly
by the selected print size (A4 smallest through A1 largest). This is
explicitly *not* perspective-matched or physically precise like the real
Gemini composite is — it's a reasonable placeholder so the page shows
*something* useful while quota/billing gets sorted, not a replacement for
the real feature. Status text changed from "Preview unavailable" to "Exact
placement unavailable right now — here's an approximate preview" to set that
expectation. Verified: fallback shows correctly on both a JSON-error
response and a network failure, stays hidden on a successful composite
(including the KV/in-memory cached-hit path), and rescales when switching
print size. All three room photos (`living`/`bedroom`/`gallery`) exist as
assets but only `living` is wired into `ROOM_BACKGROUNDS` — if a second room
is ever activated, it needs its own fallback-position entry (currently
hardcoded to the "living" wall coordinates via a fixed CSS position, not a
per-room map — worth revisiting if/when that happens).

## Size guide rebuild: technical dimension marks + spec table (2026-08-22)

Replaced the print-detail page's size guide (`#sizeGuidePanel` /
`#sizeGuideVisual`, wired up in the "── Size guide ──" IIFE). The previous
version showed flat proportional rectangles next to a hand-drawn "You /
170cm" stick figure. Before touching code, four alternative directions were
mocked up as pictures (not just described) in a published artifact so Jeff
could actually see them side by side rather than imagine them from text —
that artifact is a standing reference, not part of the site itself. He
picked a combination: keep the room-preview "see it on the actual wall"
feature exactly as it already ships (that's the `.pd-room-fallback`
compositing from the entry above — untouched by this change), and replace
the on-page size guide with the "technical dimension marks" concept coupled
with a plain spec table underneath.

What changed:
- **Rectangles**: `.sg-rect` is now an outlined-only box (no fill) with
  8 small `.sg-tick` divs per item forming corner tick marks (2 ticks per
  corner, drafting-drawing style) — this reads as a measurement device
  rather than a decorative block. The previous "You" stick-figure SVG was
  dropped entirely; a standing-figure comparison and a corner-tick technical
  drawing are two different metaphors and mixing them read cluttered in the
  mockup review.
- **Active-size styling**: rather than toggling opacity on individual
  `.sg-rect` elements (the old approach), the `active-size` class now goes
  on the whole `.sg-item` wrapper, and descendant selectors
  (`.sg-item.active-size .sg-rect`, `.sg-tick`, `.sg-name`) bump the border
  to 1.5px and darken from `var(--muted)`-ish tones to full `var(--ink)`.
  Simpler to keep in sync and reads more "technical" than a fill/opacity
  change would.
- **New spec table**: `<table class="size-guide-table">` added inside the
  panel, below the rectangles, with Size/Dimensions/Suits columns —
  `#sizeGuideTableBody` populated in the same loop that builds the
  rectangles so the two stay in lockstep off one `SIZES` array (each entry
  now also carries a `use` string, e.g. A2 → "Above a desk or console").
  The active row gets `background:var(--bg)` against the panel's
  `var(--warm)` background — pops in both light and dark themes since both
  tokens invert together in `html.darkroom`.
- **Click sync**: the existing `pdSizes` click listener (fires when a
  size-pill is picked) now toggles `.active-size` on both the matching
  `.sg-item` *and* the matching table `<tr>` via a shared `matches()`
  closure, keyed off a `data-label` attribute set on each element at build
  time — cleaner than the old approach of re-deriving the label from a
  `.sg-name` text node at click time.
- **Mobile column spacing**: first pass had `SIZE`/`DIMENSIONS` header text
  running together edge-to-edge on a 390px viewport (no gap between
  columns) — table cells had `padding:...0` with no horizontal padding.
  Fixed with `padding-right:.8rem` on non-last th/td. Second pass: with that
  padding added, the narrower Dimensions column started wrapping
  "59.4 × 84.1 cm" onto two lines ("59.4 × 84.1" / "cm"), which read badly
  for a measurement. Added `white-space:nowrap` to `.sg-td-dim` so the
  Suits column (prose, wraps fine) absorbs the space pressure instead of
  the dimension figures.
- Verified: desktop (900px) and mobile (390px) screenshots of both the
  rectangles and table rendering correctly with real print data; clicking a
  size pill moves `active-size` to the correct item *and* row (checked
  programmatically, not just visually); dark mode (`html.darkroom`) resolves
  every color through the existing token set with no hardcoded literals;
  full 8-page nav + scroll regression (`test44_full_nav_regression.mjs`)
  still passes with zero JS errors after this change.
- `.sg-item`/`.sg-rect`/`.sg-dim`/`.sg-name` class names are reused from the
  old implementation (same names, new meaning/markup) — grepped the whole
  file first to confirm nothing else referenced them before repurposing.

## Shop page rendering completely empty (2026-08-22)

Jeff reported: refreshed the site, hero loaded, clicked Shop, and got the
header/description/currency-toggle but no print cards at all — just empty
space down to the footer. Reproduced live via screen access to his actual
browser (not guessed from a description): the DOM was genuinely correct —
one `.shop-card` present, right position, right size, right styling — but
its `<canvas class="shop-card-img">` was stuck at **0×0**, i.e. never drawn.

**Root cause:** the "grid protection" mechanism added earlier this session
(see the "Shop/portfolio grid image clarity vs. anti-theft canvas
protection" entry, 2026-08-21) swaps every `<img>` in `#shopList`/
`#photoGrid` for a `<canvas>`, then defers the actual fetch+decode+draw
until an `IntersectionObserver` reports the canvas as intersecting the
viewport — this was the fix for a *different* problem (decoding 80+
full-res Portfolio images at once on page load). The bug: `renderShop()`
rebuilds `#shopList`'s entire innerHTML — and therefore recreates every
canvas from scratch — on **every** visit to Shop, not just the first
(`navigate()` calls `renderShop(0)` again each time). When that rebuild
happens right after the Shop page's ancestor flips from `display:none` to
`display:block` (i.e. you just clicked "Shop"), the freshly-created canvas
is already sitting inside the visible viewport with nothing left to scroll
— so there's no future scroll event to ever trigger a notification, and
browsers don't reliably re-run intersection checks the instant an ancestor
becomes visible via a class toggle rather than actual scrolling. Confirmed
directly on the live tab: a brand-new `IntersectionObserver` attached to
that exact on-screen canvas never fired its callback at all. Whatever the
precise trigger (this looks tied to the tab's focus/visibility state at
that instant, which would explain why it isn't 100%-reproducible and why a
second refresh can "fix" it), the canvas had no fallback and no retry — it
would sit blank forever until the next full reload got lucky.

**Fix:** in `_protectGridImg` (shared by Shop and Portfolio), check the
canvas's real `getBoundingClientRect()` the instant it's created. If it's
already on/near screen (same generous margin as the existing
`rootMargin:'600px 0px'`), draw it immediately instead of waiting on
`IntersectionObserver` at all. Only canvases that are NOT yet near the
viewport at creation time (the normal case for cards further down a long
Portfolio grid) still go through the observer — so the original memory-
saving intent is fully preserved for genuinely offscreen content, this only
closes the gap for content that's already on-screen the moment it's built.
`draw()` now guards against being called twice (`drawn` flag) since the
eager path and a late-firing observer could theoretically both fire.

Verified: Playwright repro immediately after `navigate('shop')` shows the
canvas properly drawn (270×438, non-zero) with zero JS errors, both cards
count and content correct. Portfolio (87 cards) still only eagerly draws
the ~8 actually within/near the initial viewport — the other ~79 stay at
0×0 until scrolled near, confirming lazy-loading behavior is untouched.
Could not force the exact background/hidden-tab condition inside Playwright
to 100% reproduce the pre-fix failure synthetically (Playwright's multi-tab
`bringToFront` didn't toggle `document.hidden` the way it does in a real
browser) — so this fix is verified against the mechanism directly observed
on the live site (a real `IntersectionObserver` failing to notify a
genuinely on-screen canvas), not against a scripted repeat of Jeff's exact
click sequence. Flagging that honestly rather than claiming a full repro I
don't actually have.

## Room preview: removed Gemini entirely, CSS placement is now the whole feature (2026-08-23)

Jeff wasn't ready to take on Gemini billing to fix the quota exhaustion
(see the 2026-08-21 entries above), and asked to just remove the Gemini
path from the room preview, make it load faster, and adjust the CSS
placement: closer to the couch, 20% smaller.

- Deleted `_loadRoomComposite()`'s `fetch('/api/compose-room?...')` call
  entirely, along with `_roomComposeCache`/`_roomComposeKey`/`_roomReqToken`
  (no longer needed — there's no async request to dedupe/cache/race-guard
  against anymore). What used to be the error-path fallback
  (`_showRoomFallback`/`_hideRoomFallback`, the CSS-positioned framed print
  over a static room photo) is now the only rendering path, renamed to
  `_renderRoomComposite()` since "fallback" no longer describes what it is.
- Removed the `#pdRoomStatus` element and both its states — the
  "Placing your print in the room… (about 10–20s)" loading message and the
  "Exact placement unavailable right now — here's an approximate preview."
  error message. Neither applies anymore: there's no wait and no failure
  mode to report on.
- `functions/api/compose-room.js` (the Pages Function itself, and its
  `GEMINI_API_KEY` dependency) is left in place but is now dead code —
  nothing calls it. Didn't delete it since Jeff only asked to remove it
  "from this preview" (the client experience), not tear out the backend
  function/secret; worth revisiting if he decides he's done with it for
  good.
- Speed: this was the actual ask behind "make the preview show up faster."
  There was never anything slow about the CSS rendering itself — the delay
  was entirely the network round trip to Gemini (which, when it wasn't
  outright failing, was a real API call taking real time). Removing that
  call is the whole fix; confirmed via Playwright that the frame is on
  screen ~28ms after clicking "See it in a room" with zero requests to
  `/api/compose-room`.
- Placement: `.pd-room-fallback` moved from `top:33%` to `top:52%` (`left`
  unchanged at `63%`) — was sitting high up near the pendant lamp, now sits
  low over the couch's backrest, the normal "art above the sofa" spot.
  Checked both size extremes (A1 largest, A4 smallest) since a taller/wider
  frame at the same center point risks colliding with the couch — neither
  does, there's a clean gap above the cushions at every size.
- Sizing: `ROOM_FALLBACK_SIZE_PCT` cut 20% across the board — a4 16→13,
  a3 22→18, a2 29→23, a1 37→30 (rounded from the literal ×0.8).
- All of this only touches `/images/rooms/living.jpg` positioning — still
  the only room wired into `ROOM_BACKGROUNDS`/this fallback. Same caveat as
  before: a second room photo needs its own coordinates, not a shared one.

## Working style notes
- Jeff's own local WIP (splash screen work, `draft-reply.js` switched to Cloudflare
  Workers AI / llama-3.2-3b-instruct with corrected facts — phone photography not
  studio, Paystack not PayPal, Lightroom Mobile) was merged in via a proper 3-way
  git merge, not overwritten. If there's ever a conflict between in-progress local
  changes and new work from this session, merge properly — check `git log`/`git diff`
  ancestry before assuming it's safe to overwrite.
