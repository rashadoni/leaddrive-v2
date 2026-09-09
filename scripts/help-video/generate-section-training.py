#!/usr/bin/env python3
"""Generate localized help-training MP4/poster assets for selected sections.

The app streams files named:
  video/player/<slug>.<locale>.VOICE.mp4
  video/player/<slug>.<locale>.poster.jpg

This generator creates slide-based tutorial videos with localized on-screen text
and neural TTS narration. Install `edge-tts` in the Python runtime used to run
the script, or set EDGE_TTS_PYTHON to a Python binary that has it installed.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import textwrap
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SCENARIO_PATH = ROOT / "video" / "scenarios" / "section-training.json"
OUT_DIR = ROOT / "video" / "player"
TMP_DIR = ROOT / "video" / ".tmp-section-training"
FONT_REGULAR = Path("/System/Library/Fonts/Supplemental/Arial Unicode.ttf")
FONT_BOLD = Path("/System/Library/Fonts/Supplemental/Arial Bold.ttf")

WIDTH = 1280
HEIGHT = 720
LOCALES = ("az", "en", "ru")
EDGE_TTS_BIN = Path(os.environ.get("EDGE_TTS_PYTHON", sys.executable))
EDGE_VOICES = {
    "az": "az-AZ-BabekNeural",
    "en": "en-US-JennyNeural",
    "ru": "ru-RU-SvetlanaNeural",
}

COLORS = {
    "bg": (248, 249, 252),
    "ink": (25, 32, 44),
    "muted": (94, 109, 129),
    "orange": (255, 77, 0),
    "orange_dark": (202, 55, 0),
    "card": (255, 255, 255),
    "line": (226, 231, 238),
    "chip": (255, 239, 231),
}

UI = {
    "az": {
        "lesson": "Video dərslik",
        "group": "Qrup",
        "route": "Marşrut",
        "goal": "Məqsəd",
        "workflow": "İş axını",
        "result": "Nəticə",
        "action": "Ekranda addım",
        "why": "Niyə vacibdir",
        "next": "Sonrakı addım",
    },
    "en": {
        "lesson": "Video tutorial",
        "group": "Group",
        "route": "Route",
        "goal": "Goal",
        "workflow": "Workflow",
        "result": "Outcome",
        "action": "On-screen action",
        "why": "Why it matters",
        "next": "Next step",
    },
    "ru": {
        "lesson": "Видео-инструкция",
        "group": "Группа",
        "route": "Маршрут",
        "goal": "Цель",
        "workflow": "Сценарий",
        "result": "Результат",
        "action": "Действие на экране",
        "why": "Почему это важно",
        "next": "Следующий шаг",
    },
}


def font(path: Path, size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(str(path), size=size)


def draw_wrapped(
    draw: ImageDraw.ImageDraw,
    text: str,
    xy: tuple[int, int],
    max_width: int,
    font_obj: ImageFont.FreeTypeFont,
    fill: tuple[int, int, int],
    line_gap: int = 8,
) -> int:
    words = text.split()
    lines: list[str] = []
    current = ""
    for word in words:
        candidate = f"{current} {word}".strip()
        if draw.textbbox((0, 0), candidate, font=font_obj)[2] <= max_width:
            current = candidate
        else:
            if current:
                lines.append(current)
            current = word
    if current:
        lines.append(current)

    x, y = xy
    line_height = font_obj.size + line_gap
    for line in lines:
        draw.text((x, y), line, font=font_obj, fill=fill)
        y += line_height
    return y


def rounded_card(draw: ImageDraw.ImageDraw, box: tuple[int, int, int, int], radius: int = 18) -> None:
    draw.rounded_rectangle(box, radius=radius, fill=COLORS["card"], outline=COLORS["line"], width=2)


def base_slide() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (WIDTH, HEIGHT), COLORS["bg"])
    draw = ImageDraw.Draw(img)
    draw.rectangle((0, 0, WIDTH, 10), fill=COLORS["orange"])
    draw.rounded_rectangle((78, 56, 178, 92), radius=18, fill=COLORS["chip"])
    draw.text((102, 63), "LD", font=font(FONT_BOLD, 18), fill=COLORS["orange_dark"])
    return img, draw


def slide_intro(slug: str, item: dict, locale: str) -> Image.Image:
    ui = UI[locale]
    img, draw = base_slide()
    bold64 = font(FONT_BOLD, 58)
    bold22 = font(FONT_BOLD, 22)
    reg24 = font(FONT_REGULAR, 24)
    reg20 = font(FONT_REGULAR, 20)

    draw.text((88, 130), ui["lesson"], font=bold22, fill=COLORS["orange"])
    draw_wrapped(draw, localized(item["title"], locale), (88, 178), 720, bold64, COLORS["ink"], 10)
    y = draw_wrapped(draw, localized(item["goal"], locale), (92, 342), 780, reg24, COLORS["muted"], 10)

    rounded_card(draw, (880, 128, 1192, 380))
    draw.text((920, 166), ui["group"], font=bold22, fill=COLORS["ink"])
    draw.text((920, 204), localized(item["group"], locale), font=reg24, fill=COLORS["orange_dark"])
    draw.text((920, 270), ui["route"], font=bold22, fill=COLORS["ink"])
    draw_wrapped(draw, item["route"], (920, 308), 220, reg20, COLORS["muted"], 8)

    draw.rounded_rectangle((88, max(y + 42, 500), 560, max(y + 104, 562)), radius=28, fill=COLORS["orange"])
    draw.text((124, max(y + 58, 516)), slug, font=font(FONT_BOLD, 24), fill=(255, 255, 255))
    return img


def slide_steps(item: dict, locale: str, start: int) -> Image.Image:
    ui = UI[locale]
    img, draw = base_slide()
    title_font = font(FONT_BOLD, 42)
    step_font = font(FONT_REGULAR, 24)
    num_font = font(FONT_BOLD, 24)

    draw.text((88, 96), ui["workflow"], font=title_font, fill=COLORS["ink"])
    steps = item["steps"][locale][start : start + 2]
    y = 190
    for idx, step_text in enumerate(steps, start=start + 1):
        rounded_card(draw, (88, y, 1192, y + 154))
        draw.ellipse((124, y + 42, 180, y + 98), fill=COLORS["orange"])
        draw.text((143, y + 52), str(idx), font=num_font, fill=(255, 255, 255))
        draw_wrapped(draw, step_text, (214, y + 44), 880, step_font, COLORS["ink"], 10)
        y += 188
    return img


def localized(value: dict | str, locale: str) -> str:
    if isinstance(value, str):
        return value
    return value.get(locale) or value.get("en") or value.get("ru") or value.get("az") or ""


def slide_scene(slug: str, item: dict, locale: str, scene: dict, scene_no: int, total: int) -> Image.Image:
    ui = UI[locale]
    img, draw = base_slide()
    eyebrow_font = font(FONT_BOLD, 20)
    title_font = font(FONT_BOLD, 44)
    body_font = font(FONT_REGULAR, 26)
    label_font = font(FONT_BOLD, 20)
    small_font = font(FONT_REGULAR, 22)

    draw.text((88, 92), f"{scene_no}/{total} · {slug}", font=eyebrow_font, fill=COLORS["orange_dark"])
    draw_wrapped(draw, localized(scene["heading"], locale), (88, 132), 1030, title_font, COLORS["ink"], 10)

    rounded_card(draw, (88, 248, 1192, 486), 20)
    draw.text((128, 286), ui["action"], font=label_font, fill=COLORS["orange_dark"])
    y = draw_wrapped(draw, localized(scene["body"], locale), (128, 326), 950, body_font, COLORS["ink"], 12)

    if scene.get("why"):
        draw.line((128, 502, 1152, 502), fill=COLORS["line"], width=2)
        draw.text((128, 532), ui["why"], font=label_font, fill=COLORS["muted"])
        draw_wrapped(draw, localized(scene["why"], locale), (128, 568), 950, small_font, COLORS["muted"], 8)
    elif y < 540:
        draw.line((128, 526, 1152, 526), fill=COLORS["line"], width=2)
        draw_wrapped(draw, f"{ui['route']}: {item['route']}", (128, 556), 880, small_font, COLORS["muted"], 8)

    return img


def slide_outcome(item: dict, locale: str) -> Image.Image:
    ui = UI[locale]
    img, draw = base_slide()
    title_font = font(FONT_BOLD, 42)
    body_font = font(FONT_REGULAR, 28)
    small_font = font(FONT_REGULAR, 22)

    draw.text((88, 112), ui["result"], font=title_font, fill=COLORS["ink"])
    rounded_card(draw, (88, 196, 1192, 508))
    draw_wrapped(draw, localized(item["outcome"], locale), (136, 258), 920, body_font, COLORS["ink"], 14)
    draw.line((136, 420, 1144, 420), fill=COLORS["line"], width=2)
    draw_wrapped(draw, f"{ui['route']}: {item['route']}", (136, 448), 860, small_font, COLORS["muted"], 8)
    draw.rounded_rectangle((944, 570, 1192, 626), radius=28, fill=COLORS["orange"])
    draw.text((984, 585), "LeadDrive", font=font(FONT_BOLD, 24), fill=(255, 255, 255))
    return img


def slides_for(slug: str, item: dict, locale: str) -> list[Image.Image]:
    if item.get("scenes"):
        scenes = item["scenes"]
        return [
            slide_intro(slug, item, locale),
            *[slide_scene(slug, item, locale, scene, idx + 1, len(scenes)) for idx, scene in enumerate(scenes)],
            slide_outcome(item, locale),
        ]

    return [
        slide_intro(slug, item, locale),
        slide_steps(item, locale, 0),
        slide_steps(item, locale, 2),
        slide_outcome(item, locale),
    ]


def narration_for(item: dict, locale: str) -> str:
    parts = [
        localized(item["title"], locale),
        localized(item["goal"], locale),
    ]
    for scene in item.get("scenes", []):
        parts.extend(
            [
                localized(scene["heading"], locale),
                localized(scene["body"], locale),
                localized(scene.get("why", {}), locale),
            ]
        )
    if item.get("outcome"):
        parts.append(localized(item["outcome"], locale))
    return "\n\n".join(part.strip() for part in parts if part and part.strip())


def word_count(text: str) -> int:
    return len([word for word in text.split() if word.strip()])


def slide_weights(item: dict, locale: str) -> list[int]:
    weights = [word_count(f"{localized(item['title'], locale)} {localized(item['goal'], locale)}")]
    for scene in item.get("scenes", []):
        weights.append(
            word_count(
                " ".join(
                    [
                        localized(scene["heading"], locale),
                        localized(scene["body"], locale),
                        localized(scene.get("why", {}), locale),
                    ]
                )
            )
        )
    weights.append(word_count(localized(item["outcome"], locale)))
    return [max(1, weight) for weight in weights]


def media_duration(path: Path) -> float:
    result = subprocess.run(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        text=True,
        capture_output=True,
        check=True,
    )
    return float(result.stdout.strip())


def synthesize_narration(text: str, locale: str, out_path: Path) -> float:
    if not EDGE_TTS_BIN.exists():
        raise RuntimeError(
            f"Edge TTS runtime is missing at {EDGE_TTS_BIN}. "
            "Create it with: python3 -m venv /tmp/leaddrive-tts-venv && "
            "/tmp/leaddrive-tts-venv/bin/python -m pip install edge-tts"
        )

    tmp = out_path.with_suffix(".tmp.mp3")
    if tmp.exists():
        tmp.unlink()
    subprocess.run(
        [
            str(EDGE_TTS_BIN),
            "-m",
            "edge_tts",
            "--voice",
            EDGE_VOICES[locale],
            "--text",
            text,
            "--write-media",
            str(tmp),
        ],
        cwd=ROOT,
        check=True,
    )
    tmp.replace(out_path)
    return media_duration(out_path)


def durations_for_audio(total_duration: float, weights: list[int], minimum: float) -> list[float]:
    total_weight = sum(weights)
    padded_duration = max(total_duration + 2.5, len(weights) * minimum)
    durations = [max(minimum, padded_duration * weight / total_weight) for weight in weights]
    scale = padded_duration / sum(durations)
    return [duration * scale for duration in durations]


def save_jpeg(src: Image.Image, path: Path) -> None:
    src.save(path, "JPEG", quality=88, optimize=True)


def render_video(slides: list[Image.Image], slug: str, item: dict, locale: str, seconds_per_slide: float) -> None:
    work = TMP_DIR / f"{slug}.{locale}"
    if work.exists():
        shutil.rmtree(work)
    work.mkdir(parents=True, exist_ok=True)

    slide_paths = []
    for idx, slide in enumerate(slides):
        path = work / f"slide-{idx:02d}.png"
        slide.save(path)
        slide_paths.append(path)

    narration = work / "narration.mp3"
    narration_duration = synthesize_narration(narration_for(item, locale), locale, narration)
    durations = durations_for_audio(narration_duration, slide_weights(item, locale), seconds_per_slide)

    concat = work / "concat.txt"
    with concat.open("w", encoding="utf-8") as fh:
        for path, duration in zip(slide_paths, durations):
            fh.write(f"file '{path}'\n")
            fh.write(f"duration {duration:.3f}\n")
        fh.write(f"file '{slide_paths[-1]}'\n")

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    poster = OUT_DIR / f"{slug}.{locale}.poster.jpg"
    video = OUT_DIR / f"{slug}.{locale}.VOICE.mp4"
    save_jpeg(slides[0], poster)

    cmd = [
        "ffmpeg",
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        str(concat),
        "-i",
        str(narration),
        "-vf",
        "fps=30,format=yuv420p",
        "-af",
        "apad",
        "-shortest",
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "28",
        "-c:a",
        "aac",
        "-b:a",
        "96k",
        "-movflags",
        "+faststart",
        str(video),
    ]
    subprocess.run(cmd, cwd=ROOT, check=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate localized help training videos.")
    parser.add_argument(
        "--scenario",
        default=str(DEFAULT_SCENARIO_PATH),
        help="Path to scenario JSON. Defaults to video/scenarios/section-training.json.",
    )
    parser.add_argument(
        "--seconds-per-slide",
        type=float,
        default=11.5,
        help="Seconds per slide. Use 11.5 for longer tutorial videos.",
    )
    parser.add_argument("--slug", action="append", help="Generate only this slug. Can be passed multiple times.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    scenario_path = Path(args.scenario)
    if not scenario_path.is_absolute():
        scenario_path = ROOT / scenario_path

    if not scenario_path.exists():
        print(f"Missing scenario file: {scenario_path}", file=sys.stderr)
        return 1
    data = json.loads(scenario_path.read_text(encoding="utf-8"))
    if not data:
        print("No scenarios found", file=sys.stderr)
        return 1

    if args.slug:
        requested = set(args.slug)
        missing = requested.difference(data)
        if missing:
            print(f"Unknown slugs: {', '.join(sorted(missing))}", file=sys.stderr)
            return 1
        data = {slug: data[slug] for slug in data if slug in requested}

    for slug, item in data.items():
        for locale in LOCALES:
            slides = slides_for(slug, item, locale)
            render_video(slides, slug, item, locale, args.seconds_per_slide)
            print(f"generated {slug}.{locale}")

    if TMP_DIR.exists():
        shutil.rmtree(TMP_DIR)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
