#!/bin/bash
cd /Users/jeffasare/Documents/GitHub/jeffery-asare-site

echo "=== Fixing git state ==="
rm -f .git/index.lock .git/HEAD.lock
rm -rf .git/rebase-merge

echo ""
echo "=== Committing ==="
git add index.html ambient.mp3 2>/dev/null; git add index.html
git diff --cached --stat
git commit -m "Royalty-free ambient melody + minimal SVG controls" 2>&1 || echo "(nothing to commit)"

echo ""
echo "=== Pushing ==="
git push --force 2>&1

echo ""
echo "=== Done ==="
read -p "Press any key to close..."
