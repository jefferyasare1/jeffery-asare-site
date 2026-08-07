#!/bin/bash
SRC_PT="/Users/jeffasare/Documents/GitHub/To be Uploaded to website/Portraits"
SRC_RS="/Users/jeffasare/Documents/GitHub/To be Uploaded to website/Random Stories"
DEST="/Users/jeffasare/Documents/GitHub/jeffery-asare-site"

c() {
  local src="$1" dst="$2"
  if [ -f "$src" ]; then
    cp "$src" "$DEST/$dst"
    echo "✓  $dst"
  else
    echo "✗  NOT FOUND: $src"
  fi
}

echo "=== Copying 6 missing images ==="
c "$SRC_PT/Beyond the Surface.jpeg"    "pt-beyond-the-surface.jpg"
c "$SRC_PT/The Backs We Show.jpeg"     "pt-the-backs-we-show.jpg"
c "$SRC_PT/Unnamed Departure.jpeg"     "pt-unnamed-departure.jpg"
c "$SRC_RS/Shoreline Silence.jpeg"     "rs-shoreline-silence.jpg"
c "$SRC_RS/Silhouette Companion.jpg"   "rs-silhouette-companion.jpg"
c "$SRC_RS/The Feast.jpeg"             "rs-the-feast.jpg"

echo ""
echo "=== Done! ==="
echo "Now open Terminal, cd to the site folder, then run:"
echo "  git add . && git commit -m 'Add 6 missing portfolio images' && git push"
read -p "Press any key to close..."
