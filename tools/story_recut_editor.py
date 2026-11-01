#!/usr/bin/env python3
"""
Story Re-Cut Editor for Whop / clipping campaigns
==================================================

Brand-safe editing style that is MORE than a template, using ONLY the
brand's own source footage. No memes, no stickers, no stock B-roll,
no extra objects, no added voiceover, no added music.

What it does (the style suggested for the Oct-2026 YouTube Shorts update):
  1. COLD-OPEN REORDER  - segments are played in the order you list them
     in the cutmap, NOT in source order. Put the payoff first, then the
     setup, then the payoff in context. Source timestamps can jump.
  2. CROSS-CUT          - a clip can combine moments from different
     timestamps of the 1-hour source (claim at 12:00 + proof at 43:00).
  3. PUNCH ZOOM / PACING - per-segment zoom (1.0 = normal, 1.15 = punch)
     decided by the moment, plus optional tightening of leading/trailing
     silence per segment. Zooms are irregular, not a fixed template timer.
  4. CLEAN KEYWORD CAPTIONS - if you give a full-source .srt transcript,
     captions are re-timed to the NEW playback order automatically, and
     only your `keywords` are highlighted. Caption text is exactly what
     was spoken - nothing is added, so brand reviewers see clean subs.
  5. AUDIO CONTINUITY    - each segment is loudness-normalised on its own
     so cross-cutting between minute 5 and minute 50 doesn't jump in volume.

It also WARNS you if two clips in the same cutmap are near-duplicates
(same first segment + same order) - that cross-channel duplication is
what you are trying to move away from.

Requirements: ffmpeg + ffprobe on PATH (with libass for captions).

Usage:
  python3 story_recut_editor.py source_1hour.mp4 \
      --cutmap example_cutmap.json --out output/

Cutmap format: see example_cutmap.json
Output: one .mp4 per clip + manifest.json (paths + segment order +
durations - ready to feed into n8n / your continuous-edit-engine).

Integration note (for your worker): this script is a drop-in renderer.
Your maintainCampaignClipPool() can generate a cutmap JSON per campaign
(one clip object per channel/angle), call this script once, then read
manifest.json to register the rendered files in the clip pool.
"""

import argparse
import json
import math
import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

WIDTH, HEIGHT, FPS = 1080, 1920, 30


# --------------------------------------------------------------------------
# small helpers
# --------------------------------------------------------------------------
def run(cmd, **kw):
    print("  $", " ".join(str(c) for c in cmd[:6]), "..." if len(cmd) > 6 else "")
    r = subprocess.run(cmd, capture_output=True, text=True, **kw)
    if r.returncode != 0:
        err_msg = r.stderr[-1000:] if r.stderr else (r.stdout[-1000:] if r.stdout else "unknown error")
        print(f"  ❌ FFMPEG Error: {err_msg}")
        raise RuntimeError(f"FFMPEG command failed: {err_msg}")
    return r


def probe_duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "json", str(path)],
        capture_output=True, text=True, check=True)
    return float(json.loads(r.stdout)["format"]["duration"])


def parse_ts(v):
    """Accept 125.5, '125.5', '02:05', or '00:02:05.5' -> float seconds."""
    if isinstance(v, (int, float)):
        return float(v)
    parts = str(v).strip().split(":")
    parts = [float(p) for p in parts]
    while len(parts) < 3:
        parts.insert(0, 0.0)
    return parts[0] * 3600 + parts[1] * 60 + parts[2]


def fmt_ass_time(sec):
    sec = max(0.0, sec)
    h = int(sec // 3600); m = int((sec % 3600) // 60)
    s = sec % 60
    return f"{h}:{m:02d}:{s:05.2f}"


def to_ass_bgr(color_str, alpha=0):
    """Convert hex (#RRGGBB) or named color to ASS &H[AA][BB][GG][RR] format."""
    c = str(color_str or "").strip().lower()
    named = {
        "white": "FFFFFF",
        "black": "000000",
        "yellow": "00D7FF",  # BGR for yellow
        "gold": "00D7FF",
        "red": "4444EF",     # BGR for red
        "blue": "F6823B",    # BGR for blue
        "green": "22C55E",
        "cyan": "F8BD38",
    }
    if c in named:
        return f"&H{alpha:02X}{named[c]}"
    if c.startswith("#"):
        hex_c = c[1:]
        if len(hex_c) == 3:
            hex_c = "".join(ch * 2 for ch in hex_c)
        if len(hex_c) == 6:
            r = hex_c[0:2]
            g = hex_c[2:4]
            b = hex_c[4:6]
            return f"&H{alpha:02X}{b}{g}{r}"
    return f"&H{alpha:02X}FFFFFF"


def parse_bg_to_ass(bg_str):
    """Convert 'black@0.5' or '#000000' to ASS BGR color and alpha."""
    s = str(bg_str or "black@0.5").strip()
    color_part = s
    alpha_val = 0.5
    if "@" in s:
        parts = s.split("@")
        color_part = parts[0]
        try:
            alpha_val = float(parts[1])
        except ValueError:
            alpha_val = 0.5
    # ASS alpha: 0 is opaque, 255 is transparent
    ass_alpha = int(round((1.0 - min(max(alpha_val, 0.0), 1.0)) * 255))
    return to_ass_bgr(color_part, alpha=ass_alpha)


def style_on_screen_text(text, count, highlight_color, base_color="white"):
    """Highlight last `count` words in on-screen text with highlight_color in ASS."""
    if not text:
        return ""
    words = text.split()
    if not words or count <= 0:
        return text
    highlight_start = max(0, len(words) - count)
    ass_hl = to_ass_bgr(highlight_color)
    ass_base = to_ass_bgr(base_color)
    res = []
    for i, w in enumerate(words):
        if i >= highlight_start:
            res.append(f"{{\\c{ass_hl}&}}{w}{{\\c{ass_base}&}}")
        else:
            res.append(w)
    return " ".join(res)


def format_on_screen_hook(raw_text, styled_cnt, styled_color, base_color="white", font_size=52):
    """
    Format on-screen hook text for ASS:
    - Auto-wrap long single lines into balanced centered lines with \\N (prevent clipping)
    - Highlight the last `styled_cnt` words with `styled_color`
    - Normalize newlines to ASS \\N
    """
    if not raw_text or not str(raw_text).strip():
        return ""
    text = str(raw_text).strip().replace("\r\n", "\n")

    # Dynamic character limit per line based on font size (usable 900px width on 1080 canvas)
    max_chars = max(18, min(32, int(round(900.0 / (font_size * 0.58)))))

    # If text already has newlines, preserve them
    if "\n" in text:
        lines = [l.strip() for l in text.split("\n") if l.strip()]
    elif len(text) > max_chars and len(text.split()) > 2:
        words = text.split()
        total_len = len(text)
        # If text fits into 2 balanced lines:
        if total_len <= max_chars * 2 + 6:
            target_mid = total_len / 2.0
            best_split = 1
            best_diff = 9999
            curr_len = 0
            for i in range(len(words) - 1):
                curr_len += len(words[i]) + 1
                diff = abs(curr_len - target_mid)
                if diff < best_diff:
                    best_diff = diff
                    best_split = i + 1
            lines = [" ".join(words[:best_split]), " ".join(words[best_split:])]
        else:
            # Wrap into 3+ lines if very long
            lines = []
            curr = []
            curr_len = 0
            for w in words:
                if curr and (curr_len + len(w) + 1 > max_chars):
                    lines.append(" ".join(curr))
                    curr = [w]
                    curr_len = len(w)
                else:
                    curr.append(w)
                    curr_len += len(w) + (1 if len(curr) > 1 else 0)
            if curr:
                lines.append(" ".join(curr))
    else:
        lines = [text]

    # Apply word highlighting across the lines
    all_words = text.split()
    highlight_start = max(0, len(all_words) - styled_cnt) if styled_cnt > 0 else 999999
    ass_hl = to_ass_bgr(styled_color)
    ass_base = to_ass_bgr(base_color)

    word_global_idx = 0
    formatted_lines = []
    for line in lines:
        line_words = line.split()
        res_words = []
        for w in line_words:
            if word_global_idx >= highlight_start:
                res_words.append(f"{{\\c{ass_hl}&}}{w}{{\\c{ass_base}&}}")
            else:
                res_words.append(w)
            word_global_idx += 1
        formatted_lines.append(" ".join(res_words))

    return "\\N".join(formatted_lines)


def calc_logo_overlay_xy(pos_str, height_pct=None):
    """Calculate FFMPEG overlay x and y expressions for logo."""
    pos = str(pos_str or "Bottom Center").lower().replace(" ", "_")
    x = "(W-w)/2"
    if "left" in pos:
        x = "40"
    elif "right" in pos:
        x = "W-w-40"
    elif "center" in pos:
        x = "(W-w)/2"

    if height_pct is not None and str(height_pct).strip() != "":
        try:
            hp = float(height_pct)
            # Center logo vertically at height_pct%
            y = f"trunc(H*{hp/100:.3f})-(h/2)"
            return x, y
        except ValueError:
            pass

    y = "H-h-40"
    if "top" in pos:
        y = "40"
    elif "bottom" in pos:
        y = "H-h-40"
    elif "center" in pos or "middle" in pos:
        y = "(H-h)/2"
    return x, y


# --------------------------------------------------------------------------
# SRT -> re-timed, keyword-highlighted ASS for ONE clip
# --------------------------------------------------------------------------
SRT_TIME = re.compile(
    r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)")


def load_srt(path):
    if not path or not Path(path).is_file():
        return []
    try:
        raw = Path(path).read_text(encoding="utf-8", errors="ignore")
    except Exception:
        return []

    entries = []
    lines = [l.strip() for l in raw.splitlines() if l.strip()]
    i = 0
    while i < len(lines):
        m = SRT_TIME.search(lines[i])
        if m:
            g = [int(x) for x in m.groups()]
            start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
            end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
            text_lines = []
            i += 1
            while i < len(lines) and not SRT_TIME.search(lines[i]) and not lines[i].isdigit():
                text_lines.append(lines[i])
                i += 1
            cleaned_text = " ".join(text_lines).strip()
            cleaned_text = re.sub(r"<[^>]+>", "", cleaned_text).strip()
            if cleaned_text:
                entries.append((start, end, cleaned_text))
        else:
            i += 1
    return entries


def highlight(text, keywords):
    """Wrap whole-word keyword matches in an ASS colour override.
    Accent = warm yellow (&H0000D7FF in ASS BGR). Text itself is unchanged."""
    for kw in sorted(keywords, key=len, reverse=True):
        pat = re.compile(rf"\b({re.escape(kw)})\b", re.IGNORECASE)
        text = pat.sub(r"{\\c&H00D7FF&}\1{\\c&HFFFFFF&}", text)
    return text


_WHISPER_MODEL = None

def get_whisper_model():
    global _WHISPER_MODEL
    if _WHISPER_MODEL is None:
        try:
            import whisper
            model_name = os.environ.get("WHISPER_MODEL", "tiny")
            print(f"  [Whisper] Loading '{model_name}' model on CPU...")
            _WHISPER_MODEL = whisper.load_model(model_name)
        except Exception as e:
            print(f"  [Whisper] Failed to load whisper: {e}")
            _WHISPER_MODEL = False
    return _WHISPER_MODEL if _WHISPER_MODEL is not False else None


def transcribe_clip_audio(video_path: Path):
    """Transcribe a rendered clip (15-60s) in 2-3 seconds using Whisper on CPU."""
    model = get_whisper_model()
    if not model:
        return []

    wav_path = video_path.with_suffix(".whisper_clip.wav")
    try:
        cmd = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(video_path),
            "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            str(wav_path)
        ]
        subprocess.run(cmd, check=True)
        res = model.transcribe(str(wav_path), word_timestamps=True, fp16=False, verbose=False)

        raw_segments = res.get("segments", [])
        caption_blocks = []

        for seg in raw_segments:
            words = seg.get("words", [])
            if words:
                chunk = []
                for w in words:
                    w_txt = (w.get("word") or "").strip()
                    if not w_txt:
                        continue
                    chunk.append((float(w.get("start", 0.0)), float(w.get("end", 0.0)), w_txt))
                    if len(chunk) >= 4:
                        s_time = round(chunk[0][0], 2)
                        e_time = round(chunk[-1][1], 2)
                        text_str = " ".join(x[2] for x in chunk)
                        if e_time - s_time >= 0.2:
                            caption_blocks.append((s_time, e_time, text_str))
                        chunk = []
                if chunk:
                    s_time = round(chunk[0][0], 2)
                    e_time = round(chunk[-1][1], 2)
                    text_str = " ".join(x[2] for x in chunk)
                    if e_time - s_time >= 0.2:
                        caption_blocks.append((s_time, e_time, text_str))
            else:
                text_str = (seg.get("text") or "").strip()
                if text_str:
                    s_time = round(float(seg.get("start", 0.0)), 2)
                    e_time = round(float(seg.get("end", 0.0)), 2)
                    if e_time - s_time >= 0.2:
                        caption_blocks.append((s_time, e_time, text_str))

        return caption_blocks
    except Exception as e:
        print(f"  [Whisper] Transcription execution failed: {e}")
        return []
    finally:
        if wav_path.is_file():
            try: wav_path.unlink()
            except: pass


def build_ass(srt_entries, segments, keywords, out_path, on_screen_cfg=None, on_screen_text=None, subtitle_cfg=None, joined_path=None):
    """segments: list of dicts in PLAYBACK order, with start/end (source sec)."""
    events, offset, used = [], 0.0, 0
    for seg in segments:
        s, e = seg["start"], seg["end"]
        for (cs, ce, text) in srt_entries:
            if ce <= s or cs >= e:
                continue
            ns = offset + max(0.0, cs - s)
            ne = offset + min(e - s, ce - s)
            if ne - ns >= 0.15:
                events.append((ns, ne, highlight(text, keywords)))
                used += 1
        offset += (e - s)

    total_dur = max(1.0, offset if offset > 0 else 60.0)

    # Subtitle font & color options
    sub_cfg = subtitle_cfg or {}
    sub_font = sub_cfg.get("font") or "Arial"
    sub_size = int(sub_cfg.get("font_size", 54))
    sub_color = to_ass_bgr(sub_cfg.get("color", "white"))
    sub_outline = to_ass_bgr(sub_cfg.get("outline_color", "black"))
    sub_pos_pct = float(sub_cfg.get("placement_height_percent", 80))
    sub_margin_v = max(20, min(1800, int(round(HEIGHT * (1.0 - (sub_pos_pct / 100))))))

    subs_cfg_enable = sub_cfg.get("enable")
    subs_enabled = subs_cfg_enable is not False and str(subs_cfg_enable).lower() not in ("false", "0", "disabled")

    # If subtitles are disabled, clear any parsed events
    if not subs_enabled:
        events = []
    elif len(events) == 0 and joined_path and Path(joined_path).is_file():
        # Fallback: No captions matched the segment slices or no SRT was found.
        # Transcribe the joined clip audio directly using local Whisper (takes ~1-2s for a 15-60s clip).
        try:
            print("  [Subtitles] No pre-existing captions matched segments. Transcribing clip directly with Whisper...")
            clip_subs = transcribe_clip_audio(Path(joined_path))
            if clip_subs:
                print(f"  [Subtitles] ✅ Transcribed {len(clip_subs)} spoken dialogue lines directly from clip!")
                for cs, ce, ctext in clip_subs:
                    events.append((cs, ce, highlight(ctext, keywords)))
                    used += 1
            else:
                print("  [Subtitles] No dialogue detected in this video snippet.")
        except Exception as e:
            print(f"  [Subtitles] Clip audio transcription warning: {e}")

    # On-Screen Hook style & event
    extra_styles = ""
    extra_events = []
    if on_screen_text and str(on_screen_text).strip():
        osc = on_screen_cfg or {}
        os_font = osc.get("font") or "Arial"
        os_size = int(osc.get("size_px", 52))
        os_color = to_ass_bgr(osc.get("text_color", "white"))
        os_bg = parse_bg_to_ass(osc.get("background", "black@0.5"))
        styled_cnt = int(osc.get("styled_word_count", 0))
        styled_col = osc.get("styled_words_color", "yellow")
        os_height_pct = float(osc.get("position_height_percent", 27))
        # Top-center alignment uses MarginV from the TOP, centered around os_height_pct
        os_margin_v = max(10, min(1800, int(round(HEIGHT * (os_height_pct / 100.0) - (os_size * 0.8)))))

        extra_styles += (
            f"Style: OnScreenHook,{os_font},{os_size},{os_color},{os_color},&H00000000,{os_bg},"
            f"-1,0,0,0,100,100,0,0,3,12,0,8,90,90,{os_margin_v},1\n"
        )
        styled_hook = format_on_screen_hook(
            str(on_screen_text).strip(),
            styled_cnt,
            styled_col,
            base_color=osc.get("text_color", "white"),
            font_size=os_size,
        )
        extra_events.append(f"Dialogue: 1,0:00:00.00,{fmt_ass_time(total_dur)},OnScreenHook,,0,0,{os_margin_v},,{styled_hook}")
        used += 1

    sc_clean = sub_color.rstrip("&")
    so_clean = sub_outline.rstrip("&")
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {WIDTH}
PlayResY: {HEIGHT}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{sub_font},{sub_size},{sc_clean},{sc_clean},{so_clean},&H64000000,-1,0,0,0,100,100,0,0,1,4,0,2,80,80,{sub_margin_v},1
{extra_styles}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    body_lines = extra_events + [
        f"Dialogue: 0,{fmt_ass_time(a)},{fmt_ass_time(b)},Default,,0,0,0,,{t}"
        for a, b, t in events
    ]
    body = "\n".join(body_lines)
    Path(out_path).write_text(header + body + "\n", encoding="utf-8")
    return used


# --------------------------------------------------------------------------
# silence tightening (optional): trim leading/trailing silence of a segment
# --------------------------------------------------------------------------
def tighten_bounds(src, start, end, noise="-38dB", min_sil=0.35):
    seg_len = end - start
    r = subprocess.run(
        ["ffmpeg", "-hide_banner", "-ss", str(start), "-t", str(seg_len),
         "-i", str(src), "-af",
         f"silencedetect=noise={noise}:d={min_sil}", "-f", "null", "-"],
        capture_output=True, text=True)
    starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
    ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
    new_start, new_end = start, end
    # silence that begins at ~0 -> move start to where it ends
    for s0, e0 in zip(starts, ends):
        if s0 < 0.05 and e0 < seg_len:
            new_start = start + min(e0, seg_len * 0.5)
        if e0 >= seg_len - 0.05 and s0 > 0:
            new_end = start + max(s0, seg_len * 0.5)
    return new_start, new_end


# --------------------------------------------------------------------------
# render one segment (custom aspect ratio + punch zoom + centered pad)
# --------------------------------------------------------------------------
def render_segment(src, seg, out_path, aspect_ratio="9:16", bg_color="black"):
    start, end = seg["start"], seg["end"]
    dur = end - start
    zoom = float(seg.get("zoom", 1.0))
    zoom = min(max(zoom, 1.0), 1.6)

    # Box sizes inside 1080x1920 canvas
    ar = str(aspect_ratio).strip().lower()
    if ar == "4:3":
        box_w, box_h = 1080, 810
    elif ar == "1:1":
        box_w, box_h = 1080, 1080
    elif ar == "16:9":
        box_w, box_h = 1080, 608
    else:  # default 9:16
        box_w, box_h = 1080, 1920

    # Format pad color (e.g. #000000 -> 0x000000, or black)
    pad_color = str(bg_color or "black").strip()
    if pad_color.startswith("#"):
        pad_color = f"0x{pad_color[1:]}"
    elif not pad_color:
        pad_color = "black"

    # Crop with target aspect ratio and zoom from center of source (iw, ih)
    # Scale to box_w:box_h, then pad to 1080x1920 centered
    crop_vf = (
        f"crop='trunc(min(iw,ih*{box_w}/{box_h})/{zoom}/2)*2':"
        f"'trunc(min(ih,iw*{box_h}/{box_w})/{zoom}/2)*2'"
    )
    scale_vf = f"scale={box_w}:{box_h}:flags=bicubic"
    pad_vf = f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color={pad_color}"
    vf = f"{crop_vf},{scale_vf},{pad_vf},fps={FPS},setsar=1,format=yuv420p"

    preset = os.environ.get("FFMPEG_PRESET", "ultrafast")
    crf = os.environ.get("FFMPEG_CRF", "22")
    # -ss before -i for fast keyframe seek, -t after -i for exact duration cut
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{dur:.3f}",
         "-vf", vf,
         "-c:v", "libx264", "-preset", preset, "-crf", crf, "-threads", "0",
         "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
         str(out_path)])
    return dur


# --------------------------------------------------------------------------
# render one clip = ordered segments + optional burned-in clean captions & logo
# --------------------------------------------------------------------------
def render_clip(src, clip, srt_entries, out_dir, tmp, cfg, tighten=False):
    cid = re.sub(r"[^A-Za-z0-9_-]+", "_", clip["id"])
    aspect_ratio = cfg.get("video_aspect_ratio", "9:16")
    bg_color = cfg.get("frame_background_color", "black")

    segments = []
    for raw in clip["segments"]:
        s, e = parse_ts(raw["start"]), parse_ts(raw["end"])
        if e <= s:
            raise ValueError(f"clip {cid}: segment end <= start ({raw})")
        if tighten:
            try:
                s, e = tighten_bounds(src, s, e)
            except Exception as te:
                print(f"  [Tighten] Warning: {te}, using raw timestamps")
        segments.append({"start": s, "end": e, "zoom": raw.get("zoom", 1.0),
                         "role": raw.get("role", "")})

    total = sum(sg["end"] - sg["start"] for sg in segments)
    if total > 180:
        print(f"  ! WARNING {cid}: {total:.1f}s > 180s - not a Short")
    elif total > 60:
        print(f"  . note {cid}: {total:.1f}s (Shorts up to 3 min are allowed)")

    seg_files = []
    for i, seg in enumerate(segments):
        p = tmp / f"{cid}_seg{i}.mp4"
        print(f"  segment {i} [{seg['role'] or 'body'}] "
              f"source {seg['start']:.1f}-{seg['end']:.1f} zoom={seg['zoom']}")
        render_segment(src, seg, p, aspect_ratio=aspect_ratio, bg_color=bg_color)
        seg_files.append(p)

    # Use forward slashes in concat file for cross-platform compatibility
    concat_list = tmp / f"{cid}_concat.txt"
    concat_lines = "".join(f"file '{str(p).replace(chr(92), '/')}'\n" for p in seg_files)
    concat_list.write_text(concat_lines, encoding="utf-8")
    joined = tmp / f"{cid}_joined.mp4"
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-f", "concat", "-safe", "0", "-i", str(concat_list),
         "-c", "copy", str(joined)])

    final = out_dir / f"{cid}.mp4"
    keywords = clip.get("keywords", [])
    preset = os.environ.get("FFMPEG_PRESET", "ultrafast")
    crf = os.environ.get("FFMPEG_CRF", "22")

    # On-screen text & subtitles
    clip_text = clip.get("on_screen_text") or (cfg.get("on_screen_text") or {}).get("text", "")
    on_screen_cfg = cfg.get("on_screen_text") or {}
    subtitle_cfg = cfg.get("subtitles") or {}

    # Check if subtitles are enabled — enabled by default unless explicitly disabled
    subs_cfg_enable = subtitle_cfg.get("enable")
    subs_enabled = subs_cfg_enable is not False and str(subs_cfg_enable).lower() not in ("false", "0", "disabled")
    active_srt = srt_entries if subs_enabled else []

    ass_path = None
    if subs_enabled or (clip_text and str(clip_text).strip()):
        try:
            ass = tmp / f"{cid}.ass"
            n = build_ass(active_srt, segments, keywords, ass, on_screen_cfg=on_screen_cfg, on_screen_text=clip_text, subtitle_cfg=subtitle_cfg, joined_path=joined)
            if n > 0:
                ass_path = ass
                print(f"  captions/on-screen hook: {n} element(s) burned")
        except Exception as ass_err:
            print(f"  ⚠️ Subtitle / on-screen text build failed ({ass_err})")

    # Logo overlay
    logo_cfg = cfg.get("logo") or {}
    logo_file = logo_cfg.get("path")
    has_logo = logo_file and Path(logo_file).is_file()

    try:
        if ass_path and has_logo:
            ass_esc = str(ass_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
            logo_w = max(20, min(1000, int(round(WIDTH * (float(logo_cfg.get("width_percent", 40)) / 100)))))
            lx, ly = calc_logo_overlay_xy(logo_cfg.get("position", "Bottom Center"), logo_cfg.get("height_percent"))
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(joined),
                 "-i", str(logo_file),
                 "-filter_complex", f"[1:v]scale={logo_w}:-1[logo];[0:v]ass='{ass_esc}'[v_ass];[v_ass][logo]overlay={lx}:{ly}[final_v]",
                 "-map", "[final_v]",
                 "-c:v", "libx264", "-preset", preset, "-crf", crf, "-threads", "0",
                 "-map", "0:a?", "-c:a", "copy",
                 str(final)])
        elif ass_path:
            ass_esc = str(ass_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(joined),
                 "-vf", f"ass='{ass_esc}'",
                 "-c:v", "libx264", "-preset", preset, "-crf", crf, "-threads", "0",
                 "-c:a", "copy",
                 str(final)])
        elif has_logo:
            logo_w = max(20, min(1000, int(round(WIDTH * (float(logo_cfg.get("width_percent", 40)) / 100)))))
            lx, ly = calc_logo_overlay_xy(logo_cfg.get("position", "Bottom Center"), logo_cfg.get("height_percent"))
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(joined),
                 "-i", str(logo_file),
                 "-filter_complex", f"[1:v]scale={logo_w}:-1[logo];[0:v][logo]overlay={lx}:{ly}[final_v]",
                 "-map", "[final_v]",
                 "-c:v", "libx264", "-preset", preset, "-crf", crf, "-threads", "0",
                 "-map", "0:a?", "-c:a", "copy",
                 str(final)])
        else:
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(joined),
                 "-c", "copy",
                 str(final)])
    except Exception as render_err:
        print(f"  ⚠️ Advanced overlay failed ({render_err}), falling back to direct copy")
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(joined), "-c", "copy", str(final)])

    return {"id": cid, "file": str(final),
            "duration_sec": round(probe_duration(final), 2),
            "playback_order_source_ranges": [
                [round(sg["start"], 2), round(sg["end"], 2)] for sg in segments],
            "roles": [sg["role"] for sg in segments]}

    return {"id": cid, "file": str(final),
            "duration_sec": round(probe_duration(final), 2),
            "playback_order_source_ranges": [
                [round(sg["start"], 2), round(sg["end"], 2)] for sg in segments],
            "roles": [sg["role"] for sg in segments]}


def warn_on_duplicates(clips):
    seen = {}
    for c in clips:
        if not c["segments"]:
            continue
        first = c["segments"][0]
        key = (round(parse_ts(first["start"])), round(parse_ts(first["end"])),
               tuple((round(parse_ts(s["start"])), round(parse_ts(s["end"])))
                     for s in c["segments"]))
        if key in seen:
            print(f"  ! DUPLICATE WARNING: '{c['id']}' has the same hook + "
                  f"segment order as '{seen[key]}'. Give it a different angle/"
                  f"segment - do not rely on a filter/template to differ it.")
        else:
            seen[key] = c["id"]


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("source", help="1-hour (or any) source video")
    ap.add_argument("--cutmap", required=True, help="cutmap JSON file")
    ap.add_argument("--out", default="output", help="output folder")
    ap.add_argument("--tighten", action="store_true",
                    help="trim leading/trailing silence inside each segment")
    args = ap.parse_args()

    src = Path(args.source)
    if not src.exists():
        raise SystemExit(f"source not found: {src}")
    cfg = json.loads(Path(args.cutmap).read_text(encoding="utf-8"))
    clips = cfg["clips"]
    warn_on_duplicates(clips)

    srt_entries = []
    srt_path = cfg.get("captions_srt")
    if not srt_path or not Path(srt_path).is_file():
        # Fallback 1: same name in transcripts dir
        cand1 = src.parent.parent / "transcripts" / f"{src.stem}.srt"
        if cand1.is_file():
            srt_path = str(cand1)
        else:
            # Fallback 2: next to source
            cand2 = src.with_suffix(".srt")
            if cand2.is_file():
                srt_path = str(cand2)
            else:
                # Fallback 3: any .srt in transcripts dir
                tr_dir = src.parent.parent / "transcripts"
                if tr_dir.is_dir():
                    srts = list(tr_dir.glob("*.srt"))
                    if srts:
                        srt_path = str(srts[0])

    if srt_path and Path(srt_path).is_file():
        srt_entries = load_srt(srt_path)
        print(f"Loaded {len(srt_entries)} caption lines from {srt_path}")
    else:
        print(f"No SRT captions file found for {src.name}")

    src_dur = probe_duration(src)
    out_dir = Path(args.out); out_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for clip in clips:
            try:
                skip_clip = False
                for raw in clip["segments"]:
                    if parse_ts(raw["end"]) > src_dur + 0.5:
                        print(f"  ⚠️ Skipping clip {clip['id']}: segment is beyond source duration ({src_dur:.1f}s)")
                        skip_clip = True
                        break
                if skip_clip:
                    continue
                print(f"\nRendering clip: {clip['id']}")
                res = render_clip(src, clip, srt_entries, out_dir, tmp, cfg, tighten=args.tighten)
                if res:
                    manifest.append(res)
            except Exception as clip_err:
                print(f"  ❌ Error rendering clip {clip.get('id', 'unknown')}: {clip_err}")

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nDone. {len(manifest)} clip(s) in {out_dir}/ + manifest.json")


if __name__ == "__main__":
    main()
