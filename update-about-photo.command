#!/bin/bash
cd "$(dirname "$0")"

echo "Clearing any stale git locks..."
rm -f .git/HEAD.lock .git/index.lock .git/refs/remotes/origin/main.lock

echo "Syncing with GitHub..."
git fetch origin
rm -f .git/HEAD.lock .git/index.lock

# git reset --hard throws away any local changes with no confirmation — if
# something's been edited here since the last commit (a photo swap, a CMS
# save that hasn't pushed yet), this used to discard it silently.
# (security assessment, Finding 13, 2026-08-24)
if [ -n "$(git status --porcelain)" ]; then
  echo ""
  echo "⚠️  You have uncommitted local changes — stopping before they'd be lost:"
  git status --porcelain
  echo ""
  echo "Commit or stash these first, then run this again."
  read -p "Press Enter to close..."
  exit 1
fi

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
