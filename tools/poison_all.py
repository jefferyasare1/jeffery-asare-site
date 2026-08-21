#!/usr/bin/env python3
"""
poison_all.py
-------------
Batch-poisons every portfolio and shop image so AI upscalers render
Jeff's logo at 80% center instead of enhancing the photo.

Runs poison.py logic on every JPG/PNG under images/portfolio/.
Overwrites each image in place (same path, same filename).
Logs progress to tools/poison_all.log — safe to interrupt and resume.

USAGE (run from the repo root):
  python tools/poison_all.py

  # With GPU (10x faster):
  python tools/poison_all.py --gpu

  # Adjust strength (default epsilon=8, invisible):
  python tools/poison_all.py --epsilon 10 --steps 250
"""

import argparse
import os
import sys
import glob
import time
import json

# Make sure poison.py functions are importable
TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT  = os.path.dirname(TOOLS_DIR)
sys.path.insert(0, TOOLS_DIR)

try:
    import torch
    from PIL import Image
    import numpy as np
except ImportError:
    print("ERROR: Missing dependencies. Run: pip install torch torchvision pillow")
    sys.exit(1)

# Import core functions from poison.py
from poison import load_model, load_photo, poison, img_to_tensor, tensor_to_img


LOG_PATH  = os.path.join(TOOLS_DIR, 'poison_all.log')
LOGO_PATH = os.path.join(REPO_ROOT, 'images', 'ui', 'logo-mark.png')
IMG_DIRS  = [
    os.path.join(REPO_ROOT, 'images', 'portfolio'),
]


def find_images():
    images = []
    for d in IMG_DIRS:
        for ext in ('*.jpg', '*.jpeg', '*.JPG', '*.JPEG', '*.png', '*.PNG'):
            images += glob.glob(os.path.join(d, '**', ext), recursive=True)
    # Exclude UI and room images
    images = [p for p in images if
              'ui' + os.sep not in p and
              'rooms' + os.sep not in p]
    return sorted(set(images))


def load_log():
    if os.path.exists(LOG_PATH):
        with open(LOG_PATH) as f:
            return json.load(f)
    return {}


def save_log(log):
    with open(LOG_PATH, 'w') as f:
        json.dump(log, f, indent=2)


def main():
    ap = argparse.ArgumentParser(description='Batch adversarial logo poisoning')
    ap.add_argument('--coverage', type=float, default=0.8,
                    help='Logo coverage of short side (default 0.8 = 80%%)')
    ap.add_argument('--epsilon',  type=float, default=8.0,
                    help='Max pixel shift 0-255 (default 8, invisible)')
    ap.add_argument('--steps',    type=int,   default=200,
                    help='Optimization steps per image (default 200)')
    ap.add_argument('--lr',       type=float, default=0.002,
                    help='Learning rate (default 0.002)')
    ap.add_argument('--max-size', type=int,   default=1024,
                    help='Max input resolution (default 1024)')
    ap.add_argument('--patch',    type=int,   default=256,
                    help='Patch size (default 256)')
    ap.add_argument('--gpu',      action='store_true',
                    help='Use CUDA GPU (strongly recommended)')
    ap.add_argument('--reset',    action='store_true',
                    help='Ignore log and reprocess everything')
    args = ap.parse_args()

    device = 'cuda' if (args.gpu and torch.cuda.is_available()) else 'cpu'
    if args.gpu and device == 'cpu':
        print("Note: GPU requested but CUDA unavailable. Running on CPU.")

    if not os.path.exists(LOGO_PATH):
        print(f"ERROR: Logo not found at {LOGO_PATH}")
        sys.exit(1)

    images = find_images()
    if not images:
        print("No images found. Check that images/portfolio/ exists.")
        sys.exit(1)

    log = {} if args.reset else load_log()
    total    = len(images)
    done     = sum(1 for p in images if log.get(p) == 'ok')
    skipped  = 0
    failed   = []

    print(f"\n{'='*60}")
    print(f"  Adversarial Logo Poisoning - Batch Mode")
    print(f"{'='*60}")
    print(f"  Images found : {total}")
    print(f"  Already done : {done}")
    print(f"  To process   : {total - done}")
    print(f"  Device       : {device}")
    print(f"  Epsilon      : {args.epsilon}/255")
    print(f"  Steps        : {args.steps}")
    print(f"  Logo         : {LOGO_PATH}")
    print(f"{'='*60}\n")

    if total - done == 0:
        print("All images already processed. Use --reset to reprocess.")
        return

    print("Loading model ...")
    model = load_model(device)
    print("Model ready.\n")

    for i, path in enumerate(images, 1):
        rel = os.path.relpath(path, REPO_ROOT)

        if log.get(path) == 'ok':
            print(f"[{i:3d}/{total}] SKIP  {rel}")
            skipped += 1
            continue

        print(f"\n[{i:3d}/{total}] {rel}")
        t0 = time.time()
        try:
            photo_np = load_photo(path, args.max_size)
            poisoned = poison(
                model, photo_np, LOGO_PATH,
                coverage = args.coverage,
                epsilon  = args.epsilon / 255.0,
                steps    = args.steps,
                lr       = args.lr,
                device   = device,
                patch    = args.patch,
            )
            # Save back to the same path (in place)
            ext = os.path.splitext(path)[1].lower()
            if ext in ('.jpg', '.jpeg'):
                Image.fromarray(poisoned).save(path, quality=95)
            else:
                Image.fromarray(poisoned).save(path)

            elapsed = time.time() - t0
            log[path] = 'ok'
            save_log(log)
            print(f"  Done in {elapsed:.0f}s  ->  saved in place")

        except KeyboardInterrupt:
            print("\n\nInterrupted. Progress saved to tools/poison_all.log.")
            print("Run again to resume from where you left off.")
            sys.exit(0)
        except Exception as e:
            print(f"  ERROR: {e}")
            log[path] = f'error: {e}'
            failed.append(rel)
            save_log(log)

    print(f"\n{'='*60}")
    print(f"  Batch complete")
    print(f"  Processed : {total - done - len(failed)}")
    print(f"  Skipped   : {skipped}")
    print(f"  Failed    : {len(failed)}")
    if failed:
        print(f"\n  Failed files:")
        for f in failed:
            print(f"    {f}")
    print(f"\n  Log saved to: {LOG_PATH}")
    print(f"{'='*60}")
    print("\nAll done. Upload (git push) to publish the poisoned images.")


if __name__ == '__main__':
    main()
