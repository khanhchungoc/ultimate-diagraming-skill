#!/usr/bin/env python3
"""Encode captured demo PNG frames + camera keyframes into a compact animated WebP and JPEG poster.

Usage:
    python3 dev/tools/encode_demo_webp.py <frames_dir> <out_webp> [--width 800] [--height 450] [--quality 72]
"""

import argparse
import json
import sys
from pathlib import Path
from PIL import Image, ImageChops


def clamp(val: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, val))


def damp(cur: float, target: float, smooth: float, eps: float = 0.002) -> float:
    if abs(target - cur) <= eps:
        return target
    nxt = cur + (target - cur) * smooth
    return target if abs(target - nxt) <= eps else nxt


def crop_camera(img: Image.Image, zoom: float, cx: float, cy: float, out_w: int, out_h: int) -> Image.Image:
    """Crop `img` around normalized focus (cx, cy) at `zoom` >= 1.0, then resize to (out_w, out_h)."""
    src_w, src_h = img.size
    zoom = max(1.0, float(zoom))
    crop_w = src_w / zoom
    crop_h = src_h / zoom

    target_ar = out_w / out_h
    if crop_w / crop_h > target_ar:
        crop_w = crop_h * target_ar
    else:
        crop_h = crop_w / target_ar

    center_x = clamp(cx, 0.0, 1.0) * src_w
    center_y = clamp(cy, 0.0, 1.0) * src_h

    left = clamp(center_x - crop_w / 2.0, 0.0, src_w - crop_w)
    top = clamp(center_y - crop_h / 2.0, 0.0, src_h - crop_h)
    box = (left, top, left + crop_w, top + crop_h)

    cropped = img.crop(box)
    return cropped.resize((out_w, out_h), Image.Resampling.LANCZOS)


def frames_equal(a: Image.Image, b: Image.Image) -> bool:
    """Fast exact-or-near-identical check so static holds merge into a single WebP frame."""
    diff = ImageChops.difference(a, b)
    return diff.getbbox() is None


def main() -> int:
    parser = argparse.ArgumentParser(description="Encode demo frames to animated WebP + JPEG poster.")
    parser.add_argument("frames_dir", help="Directory containing manifest.json and PNG frames")
    parser.add_argument("out_webp", help="Output path for animated .webp")
    parser.add_argument("--width", type=int, default=800, help="Output width in px (default: 800)")
    parser.add_argument("--height", type=int, default=450, help="Output height in px (default: 450)")
    parser.add_argument("--quality", type=int, default=72, help="WebP quality 1-100 (default: 72)")
    parser.add_argument("--poster", help="Optional output path for .poster.jpg (defaults next to out_webp)")
    args = parser.parse_args()

    frames_dir = Path(args.frames_dir)
    manifest_path = frames_dir / "manifest.json"
    if not manifest_path.exists():
        print(f"error: missing {manifest_path}", file=sys.stderr)
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entries = manifest.get("frames", [])
    if not entries:
        print("error: manifest has no frames", file=sys.stderr)
        return 1

    processed = []
    durations = []

    cam_zoom = float(entries[0].get("zoom", 1.0))
    cam_cx = float(entries[0].get("cx", 0.5))
    cam_cy = float(entries[0].get("cy", 0.5))

    for entry in entries:
        frame_path = frames_dir / entry["file"]
        target_zoom = float(entry.get("zoom", 1.0))
        target_cx = float(entry.get("cx", 0.5))
        target_cy = float(entry.get("cy", 0.5))
        smooth = float(entry.get("smooth", 0.24))

        cam_zoom = damp(cam_zoom, target_zoom, smooth)
        cam_cx = damp(cam_cx, target_cx, smooth)
        cam_cy = damp(cam_cy, target_cy, smooth)

        dur = max(20, int(round(entry.get("durationMs", 60))))
        with Image.open(frame_path) as raw:
            rgb = raw.convert("RGB")
            frame = crop_camera(rgb, cam_zoom, cam_cx, cam_cy, args.width, args.height)

        if processed and frames_equal(processed[-1], frame):
            durations[-1] += dur
        else:
            processed.append(frame)
            durations.append(dur)

    out_webp = Path(args.out_webp)
    out_webp.parent.mkdir(parents=True, exist_ok=True)

    poster_path = Path(args.poster) if args.poster else out_webp.with_suffix(".poster.jpg")
    poster_index = int(manifest.get("posterFrame", 0))
    poster_index = max(0, min(len(processed) - 1, poster_index))
    processed[poster_index].save(poster_path, format="JPEG", quality=85, optimize=True, progressive=True)

    processed[0].save(
        out_webp,
        format="WEBP",
        save_all=True,
        append_images=processed[1:],
        duration=durations,
        loop=0,
        quality=args.quality,
        method=6,
        minimize_size=True,
    )

    total_ms = sum(durations)
    webp_kb = out_webp.stat().st_size / 1024.0
    poster_kb = poster_path.stat().st_size / 1024.0
    print(f"Wrote {out_webp} ({len(processed)} frames, {total_ms / 1000.0:.2f}s, {webp_kb:.1f} KB)")
    print(f"Wrote {poster_path} ({poster_kb:.1f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
