#!/bin/bash
# cleanup-junk.command
# Double-click this in Finder to clean up the repo root.
# Nothing is permanently deleted — junk files move to _to-delete/.
# Review that folder, then empty it when you're ready.

REPO="$(cd "$(dirname "$0")" && pwd)"
cd "$REPO"

echo "=== jeffery-asare-site cleanup ==="
echo ""

# ── Step 1: Create holding folder ──────────────────────────────────
mkdir -p "_to-delete"
echo "Holding folder ready: _to-delete/"
echo ""

# ── Step 2: Move editor backup files (.jpg~) ────────────────────────
COUNT=$(find . -maxdepth 1 -name "*.jpg~" | wc -l | tr -d ' ')
if [ "$COUNT" -gt 0 ]; then
  echo "Moving $COUNT editor backup files (.jpg~) → _to-delete/..."
  find . -maxdepth 1 -name "*.jpg~" -exec mv {} "_to-delete/" \;
  echo "Done."
else
  echo "No .jpg~ backup files found."
fi
echo ""

# ── Step 3: Move colon-named artifact ──────────────────────────────
if [ -f ":rs-silhouette-companion.jpg" ]; then
  echo "Moving :rs-silhouette-companion.jpg → _to-delete/..."
  mv -- ":rs-silhouette-companion.jpg" "_to-delete/" && echo "Done." || echo "Could not move — try dragging it in Finder."
else
  echo "No :rs-silhouette-companion.jpg found."
fi
echo ""

# ── Step 4: Move unreferenced orphan photo ─────────────────────────
if [ -f "the-village.jpg" ]; then
  echo "Moving orphan the-village.jpg → _to-delete/..."
  mv "the-village.jpg" "_to-delete/" && echo "Done."
else
  echo "No the-village.jpg found."
fi
echo ""

# ── Step 5: Organize notes into docs/ ──────────────────────────────
DOCS_MOVED=0
mkdir -p "docs"
for f in "PHOTO-NAMES-FINAL.md" "ORDER-WORKFLOW.md" "photo-rename-options.md"; do
  if [ -f "$f" ]; then
    mv "$f" "docs/" && echo "Moved $f → docs/" && DOCS_MOVED=$((DOCS_MOVED+1))
  fi
done
if [ "$DOCS_MOVED" -eq 0 ]; then
  echo "No markdown notes to move (already organized or missing)."
fi
echo ""

# ── Done ────────────────────────────────────────────────────────────
echo "=== Done! ==="
echo "Root now has $(ls -1 | wc -l | tr -d ' ') items."
echo ""
echo "→ Review _to-delete/ before emptying it."
echo "→ Notes are in docs/"
echo ""
read -p "Press Enter to close..."
