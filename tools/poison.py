#!/usr/bin/env python3
"""
adversarial-logo-poison.py
--------------------------
Bakes imperceptible pixel perturbations into a photo so that when anyone
runs it through an AI upscaler (Real-ESRGAN, Topaz, ChatGPT Enhance, etc.),
the upscaler outputs the photo with Jeff's logo rendered at 80% center
instead of a clean enhancement.

The perturbation is invisible to the human eye (max 8/255 per channel).
It is mathematically tuned to exploit how neural upscalers reconstruct detail.

REQUIREMENTS
  pip install torch torchvision pillow requests

  The first run auto-downloads the Real-ESRGAN model weights (~64 MB).

USAGE
  python poison.py --photo path/to/photo.jpg --logo path/to/logo.png --out path/to/output.jpg

  # Optional flags:
  --coverage 0.8    Logo covers 80% of image short side (default)
  --epsilon  8      Max pixel shift per channel, 0-255 scale (default 8, invisible)
  --steps    200    Optimization iterations (more = stronger effect, slower)
  --max-size 1024   Resize photo to this max dimension before processing
  --gpu             Use CUDA GPU if available (10x faster)

WORKFLOW
  1. Run this script on each photo you want protected before uploading to the site.
  2. Upload the poisoned output file in place of the original.
  3. Visitors see a normal photo. Screenshots look normal on screen.
  4. Anyone who runs the screenshot through an AI upscaler gets your logo.
"""

import argparse
import os
import sys
import urllib.request
import numpy as np

try:
    import torch
    import torch.nn as nn
    import torch.nn.functional as F
except ImportError:
    print("ERROR: PyTorch not found. Run: pip install torch torchvision")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("ERROR: Pillow not found. Run: pip install pillow")
    sys.exit(1)


# ---------------------------------------------------------------------------
# Real-ESRGAN model (RRDB architecture, 4x upscale)
# Inline implementation so no external packages needed beyond torch.
# ---------------------------------------------------------------------------

class ResidualDenseBlock(nn.Module):
    def __init__(self, num_feat=64, num_grow_ch=32):
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, num_feat, num_grow_ch=32):
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x):
        out = self.rdb1(x)
        out = self.rdb2(out)
        out = self.rdb3(out)
        return out * 0.2 + x


class RRDBNet(nn.Module):
    """Real-ESRGAN generator (x4 scale, 23 RRDB blocks)."""
    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64,
                 num_block=23, num_grow_ch=32, scale=4):
        super().__init__()
        self.scale = scale
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        # Upsample
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr   = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2, inplace=True)

    def forward(self, x):
        feat = self.conv_first(x)
        body_feat = self.conv_body(self.body(feat))
        feat = feat + body_feat
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode='nearest')))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode='nearest')))
        out  = self.conv_last(self.lrelu(self.conv_hr(feat)))
        return out


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

WEIGHTS_URL  = 'https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth'
WEIGHTS_PATH = os.path.expanduser('~/.cache/realesrgan/RealESRGAN_x4plus.pth')


def _download_weights():
    os.makedirs(os.path.dirname(WEIGHTS_PATH), exist_ok=True)
    print(f"Downloading Real-ESRGAN weights (~64 MB) to {WEIGHTS_PATH} ...")
    urllib.request.urlretrieve(WEIGHTS_URL, WEIGHTS_PATH,
        reporthook=lambda b, bs, t: print(f"  {min(100, int(b*bs*100/t))}%  ", end='\r'))
    print("Download complete.")


def load_model(device):
    if not os.path.exists(WEIGHTS_PATH):
        _download_weights()
    model = RRDBNet()
    ckpt  = torch.load(WEIGHTS_PATH, map_location='cpu')
    params = ckpt.get('params_ema', ckpt.get('params', ckpt))
    model.load_state_dict(params, strict=True)
    return model.eval().to(device)


def img_to_tensor(arr, device):
    """HxWxC float32 [0,1] -> 1xCxHxW tensor."""
    return torch.from_numpy(arr).permute(2, 0, 1).unsqueeze(0).float().to(device)


def tensor_to_img(t):
    """1xCxHxW tensor -> HxWxC uint8."""
    return (t.squeeze(0).permute(1, 2, 0).clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)


def load_photo(path, max_size):
    img = Image.open(path).convert('RGB')
    if max(img.size) > max_size:
        img.thumbnail((max_size, max_size), Image.LANCZOS)
    return np.array(img).astype(np.float32) / 255.0


def make_target_upscaled(photo_np, logo_path, coverage, scale=4):
    """
    Returns the 4x upscaled composite: photo with logo at `coverage` of
    the shorter dimension, centered, alpha-composited.
    """
    h, w = photo_np.shape[:2]

    # --- logo overlay on low-res photo ---
    logo_px = int(min(h, w) * coverage)
    logo_img = Image.open(logo_path).convert('RGBA').resize((logo_px, logo_px), Image.LANCZOS)
    logo_np  = np.array(logo_img).astype(np.float32) / 255.0

    composite = photo_np.copy()
    y0 = (h - logo_px) // 2
    x0 = (w - logo_px) // 2
    alpha   = logo_np[:, :, 3:4]
    rgb     = logo_np[:, :, :3]
    region  = composite[y0:y0+logo_px, x0:x0+logo_px]
    composite[y0:y0+logo_px, x0:x0+logo_px] = alpha * rgb + (1 - alpha) * region

    # --- upscale composite to 4x using Lanczos as the target ---
    target_pil = Image.fromarray((composite * 255).astype(np.uint8))
    target_big = target_pil.resize((w * scale, h * scale), Image.LANCZOS)
    return np.array(target_big).astype(np.float32) / 255.0


# ---------------------------------------------------------------------------
# PGD targeted attack (patch-based for memory efficiency)
# ---------------------------------------------------------------------------

def poison(model, photo_np, logo_path, coverage, epsilon, steps, lr, device,
           patch=256, n_patches_per_step=4):
    """
    Finds delta such that upscaler(photo + delta) ≈ upscale(photo + logo).
    Returns poisoned photo as HxWxC uint8.
    """
    print("Building 4x target composite ...")
    target_big = make_target_upscaled(photo_np, logo_path, coverage)

    x = img_to_tensor(photo_np, device)        # 1x3xHxW
    t = img_to_tensor(target_big, device)      # 1x3x(4H)x(4W)

    h, w = photo_np.shape[:2]

    delta = torch.zeros_like(x, requires_grad=False)
    delta.requires_grad_(True)
    opt = torch.optim.Adam([delta], lr=lr)

    print(f"Poisoning ({steps} steps, epsilon={epsilon*255:.0f}/255, device={device}) ...")
    for step in range(steps):
        opt.zero_grad()
        adv = (x + delta).clamp(0, 1)

        total_loss = torch.tensor(0.0, device=device)

        for _ in range(n_patches_per_step):
            # Random patch on the low-res input
            py = np.random.randint(0, max(1, h - patch))
            px = np.random.randint(0, max(1, w - patch))
            p_in  = adv[:, :, py:py+patch,      px:px+patch]
            p_tgt = t  [:, :, py*4:(py+patch)*4, px*4:(px+patch)*4]

            p_out = model(p_in)
            total_loss = total_loss + F.mse_loss(p_out, p_tgt)

        total_loss = total_loss / n_patches_per_step
        total_loss.backward()
        opt.step()

        with torch.no_grad():
            delta.data.clamp_(-epsilon, epsilon)
            delta.data = (x + delta.data).clamp(0, 1) - x

        if step % 50 == 0 or step == steps - 1:
            pct = (step + 1) * 100 // steps
            dmax = delta.abs().max().item() * 255
            print(f"  [{pct:3d}%] step {step+1:4d}/{steps}  "
                  f"loss={total_loss.item():.5f}  "
                  f"max_delta={dmax:.1f}/255")

    poisoned = (x + delta.detach()).clamp(0, 1)
    return tensor_to_img(poisoned)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    ap = argparse.ArgumentParser(
        description="Poison a photo so AI upscalers render Jeff's logo at 80% center."
    )
    ap.add_argument('--photo',    required=True,  help='Input photo (JPG/PNG)')
    ap.add_argument('--logo',     required=True,  help='Logo PNG with transparency (ja. mark)')
    ap.add_argument('--out',      required=True,  help='Output poisoned photo path')
    ap.add_argument('--coverage', type=float, default=0.8,
                    help='Logo size as fraction of image short side (default 0.8 = 80%%)')
    ap.add_argument('--epsilon',  type=float, default=8.0,
                    help='Max pixel shift per channel on 0-255 scale (default 8, invisible)')
    ap.add_argument('--steps',    type=int,   default=200,
                    help='Optimization steps (default 200; more = stronger effect)')
    ap.add_argument('--lr',       type=float, default=0.002,
                    help='Adam learning rate for delta (default 0.002)')
    ap.add_argument('--max-size', type=int,   default=1024,
                    help='Resize photo to this max dimension (default 1024)')
    ap.add_argument('--gpu',      action='store_true',
                    help='Use CUDA GPU (10x faster)')
    ap.add_argument('--patch',    type=int,   default=256,
                    help='Patch size for gradient computation (default 256)')
    args = ap.parse_args()

    device = 'cuda' if (args.gpu and torch.cuda.is_available()) else 'cpu'
    if args.gpu and device == 'cpu':
        print("Note: GPU requested but CUDA not available. Running on CPU (slower).")

    print(f"\nDevice   : {device}")
    print(f"Photo    : {args.photo}")
    print(f"Logo     : {args.logo}")
    print(f"Coverage : {args.coverage*100:.0f}%")
    print(f"Epsilon  : {args.epsilon}/255")
    print(f"Steps    : {args.steps}")
    print()

    photo_np = load_photo(args.photo, args.max_size)
    print(f"Photo loaded: {photo_np.shape[1]}x{photo_np.shape[0]} px")

    model = load_model(device)
    print("Model ready.")
    print()

    poisoned = poison(
        model, photo_np, args.logo,
        coverage = args.coverage,
        epsilon  = args.epsilon / 255.0,
        steps    = args.steps,
        lr       = args.lr,
        device   = device,
        patch    = args.patch,
    )

    Image.fromarray(poisoned).save(args.out, quality=95)
    print(f"\nSaved: {args.out}")
    print("Upload this file to your site in place of the original.")
    print("To the eye: identical. To an AI upscaler: your logo.")


if __name__ == '__main__':
    main()
