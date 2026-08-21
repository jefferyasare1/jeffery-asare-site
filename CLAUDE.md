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
- **Unconfirmed / needs a live check next time this comes up:** whether reordering
  the model list actually cleared the 429s, or whether the whole Gemini API key is
  out of quota (in which case Jeff needs to check quota/billing for that key in
  Google AI Studio / Google Cloud Console — compositing at real traffic volume
  generally needs a paid tier, not the free one). Check Cloudflare Dashboard →
  Workers & Pages → jeffery-asare-site → latest deployment → Functions →
  Real-time Logs (Beta) to see the actual error if it recurs.
- KV cache: bind a KV namespace called `ROOM_CACHE_KV` in the Cloudflare dashboard
  to cache composites per (room, size, print) — already bound and working. Endpoint
  degrades gracefully (just uncached) if it's ever missing.
- Only one room exists (`living`), so the room-selector tab UI was removed — don't
  re-add a "Living room" tag/tab unless a second room background is actually added
  to `ROOM_BACKGROUNDS` in `compose-room.js`.

## Recent UI sizing changes (so future edits build on these, not the old values)
- Shop grid (`.shop-list`): 4 columns desktop / 3 tablet (≤900px) / 2 mobile
  (≤580px), was 3/2/1. Smaller cards read sharper at the same source resolution.
- Print detail image column (`.print-detail-grid`): 44% / 1fr, was 55% / 1fr.
- Room preview section (`.pd-room-preview`): capped at `max-width:620px;margin:0 auto`,
  was full-bleed edge to edge.

## Shop catalog
- `_data/prints.json` currently has exactly one print ("The Herdsman", RANDOM-STORIES
  series). Jeff has mentioned wanting more prints in the shop — don't fabricate
  titles/descriptions/prices for new prints on his behalf; ask him for the real
  content (image, title, series, edition size, description, sizes/prices) first.

## Working style notes
- Jeff's own local WIP (splash screen work, `draft-reply.js` switched to Cloudflare
  Workers AI / llama-3.2-3b-instruct with corrected facts — phone photography not
  studio, Paystack not PayPal, Lightroom Mobile) was merged in via a proper 3-way
  git merge, not overwritten. If there's ever a conflict between in-progress local
  changes and new work from this session, merge properly — check `git log`/`git diff`
  ancestry before assuming it's safe to overwrite.
