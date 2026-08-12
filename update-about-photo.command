#!/bin/bash
cd "$(dirname "$0")"

echo "Clearing any stale git locks..."
rm -f .git/HEAD.lock .git/index.lock .git/refs/remotes/origin/main.lock

echo "Syncing with GitHub..."
git fetch origin
rm -f .git/HEAD.lock .git/index.lock

git reset --hard origin/main
rm -f .git/HEAD.lock .git/index.lock

echo "Copying new about photo..."
cp images/ui/about-portrait-2.jpeg images/ui/about-portrait.jpg

echo "Committing..."
git add images/ui/about-portrait.jpg
rm -f .git/index.lock
git commit -m "Update about photo"
rm -f .git/HEAD.lock .git/index.lock

echo "Pushing..."
git push origin main

echo ""
echo "✓ Done! The new about photo is live."
read -p "Press Enter to close..."
