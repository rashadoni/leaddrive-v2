#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


WIDTH = 1280
HEIGHT = 720
FPS = 30
INK = (17, 24, 39)
ORANGE = (244, 81, 8)
WHITE = (255, 255, 255)
CAPTION_BG = (17, 24, 39, 224)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf" if bold else "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
        "/Library/Fonts/Arial Unicode.ttf",
        "/System/Library/Fonts/Supplemental/DejaVu Sans.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size=size)
    return ImageFont.load_default()


def cover(img: Image.Image) -> Image.Image:
    src_w, src_h = img.size
    scale = max(WIDTH / src_w, HEIGHT / src_h)
    new_w = int(src_w * scale)
    new_h = int(src_h * scale)
    resized = img.resize((new_w, new_h), Image.LANCZOS)
    left = max(0, (new_w - WIDTH) // 2)
    top = max(0, (new_h - HEIGHT) // 2)
    return resized.crop((left, top, left + WIDTH, top + HEIGHT))


def ease(t: float) -> float:
    t = max(0.0, min(1.0, t))
    return 1 - pow(1 - t, 4)


def draw_cursor(draw: ImageDraw.ImageDraw, x: float, y: float) -> None:
    shadow = [(x + 4, y + 4), (x + 34, y + 23), (x + 21, y + 27), (x + 28, y + 45), (x + 19, y + 49), (x + 12, y + 31), (x + 1, y + 40)]
    arrow = [(x, y), (x + 31, y + 20), (x + 18, y + 24), (x + 25, y + 43), (x + 16, y + 47), (x + 9, y + 29), (x - 2, y + 38)]
    draw.polygon(shadow, fill=(0, 0, 0, 80))
    draw.polygon(arrow, fill=WHITE, outline=(31, 41, 55))


def draw_click(draw: ImageDraw.ImageDraw, x: float, y: float, progress: float) -> None:
    if progress < 0.34 or progress > 0.92:
        return
    p = (progress - 0.34) / 0.58
    r = 20 + int(48 * p)
    alpha = int(210 * (1 - p))
    color = ORANGE + (alpha,)
    draw.ellipse((x - r, y - r, x + r, y + r), outline=color, width=5)
    draw.ellipse((x - 16, y - 16, x + 16, y + 16), outline=ORANGE + (190,), width=4)


def draw_caption(base: Image.Image, heading: str, body: str, scene_no: int, total: int) -> Image.Image:
    overlay = Image.new("RGBA", base.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)
    box = (52, 602, WIDTH - 52, HEIGHT - 28)
    draw.rounded_rectangle(box, radius=14, fill=CAPTION_BG)
    draw.text((78, 620), f"{scene_no}/{total}", font=font(18, True), fill=(255, 177, 138, 255))
    draw.text((136, 618), heading, font=font(24, True), fill=(255, 255, 255, 255))
    wrapped = textwrap.wrap(body, width=96)
    y = 650
    for line in wrapped[:2]:
        draw.text((136, y), line, font=font(18), fill=(226, 232, 240, 255))
        y += 23
    return Image.alpha_composite(base.convert("RGBA"), overlay)


def render(meta: dict) -> None:
    work = Path(meta["workDir"])
    frames_dir = work / "frames"
    if frames_dir.exists():
        shutil.rmtree(frames_dir)
    frames_dir.mkdir(parents=True)

    scenes = meta["scenes"]
    total_frames = 0
    prev = (WIDTH * 0.18, HEIGHT * 0.30)
    first_frame: Path | None = None

    for scene_index, scene in enumerate(scenes, start=1):
        screenshot = cover(Image.open(scene["screenshot"]).convert("RGB"))
        target = scene["target"]
        current = (float(target["x"]), float(target["y"]))
        scene_frames = max(60, int(round(float(scene["duration"]) * FPS)))

        for i in range(scene_frames):
            progress = i / max(1, scene_frames - 1)
            move = ease(min(1.0, progress / 0.42))
            x = prev[0] + (current[0] - prev[0]) * move
            y = prev[1] + (current[1] - prev[1]) * move
            frame = screenshot.copy().convert("RGBA")
            frame = draw_caption(frame, scene["heading"], scene["voice"], scene_index, len(scenes))
            overlay = Image.new("RGBA", frame.size, (0, 0, 0, 0))
            draw = ImageDraw.Draw(overlay)
            if scene.get("action") == "click":
                draw_click(draw, current[0], current[1], progress)
            draw_cursor(draw, x, y)
            frame = Image.alpha_composite(frame, overlay).convert("RGB")
            out = frames_dir / f"frame-{total_frames:05d}.jpg"
            frame.save(out, "JPEG", quality=92, subsampling=1)
            if first_frame is None:
                first_frame = out
            total_frames += 1
        prev = current

    if first_frame:
        shutil.copyfile(first_frame, meta["poster"])

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-framerate",
        str(FPS),
        "-i",
        str(frames_dir / "frame-%05d.jpg"),
        "-i",
        meta["audio"],
        "-vf",
        "format=yuv420p",
        "-af",
        "apad",
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "20",
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-movflags",
        "+faststart",
        meta["out"],
    ]
    subprocess.run(cmd, check=True)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--meta", required=True)
    args = parser.parse_args()
    render(json.loads(Path(args.meta).read_text("utf-8")))


if __name__ == "__main__":
    main()
