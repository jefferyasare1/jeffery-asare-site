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

## Working style notes
- Jeff's own local WIP (splash screen work, `draft-reply.js` switched to Cloudflare
  Workers AI / llama-3.2-3b-instruct with corrected facts — phone photography not
  studio, Paystack not PayPal, Lightroom Mobile) was merged in via a proper 3-way
  git merge, not overwritten. If there's ever a conflict between in-progress local
  changes and new work from this session, merge properly — check `git log`/`git diff`
  ancestry before assuming it's safe to overwrite.
