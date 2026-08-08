#!/bin/bash
cd /Users/jeffasare/Documents/GitHub/jeffery-asare-site

echo "=== Fixing git state ==="
rm -f .git/index.lock .git/HEAD.lock
rm -rf .git/rebase-merge

echo ""
echo "=== Committing ==="
git add -A
git diff --cached --stat
git commit -m "Site updates" 2>&1 || echo "(nothing to commit)"

echo ""
echo "=== Pushing ==="
git push origin main 2>&1

echo ""
echo "=== Done ==="
read -p "Press any key to close..."
