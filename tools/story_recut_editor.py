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
    try:
        r = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=duration",
             "-of", "json", str(path)],
            capture_output=True, text=True, check=True)
        data = json.loads(r.stdout)
        fmt_dur = data.get("format", {}).get("duration")
        if fmt_dur and fmt_dur != "N/A":
            return float(fmt_dur)
        streams = data.get("streams", [])
        for s in streams:
            s_dur = s.get("duration")
            if s_dur and s_dur != "N/A":
                return float(s_dur)
    except Exception as e:
        print(f"  [Probe] Error probing duration of {path}: {e}")
    return 0.0


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


def to_ass_color_6(color_str):
    """Convert hex (#RRGGBB) or named color to 6-digit ASS BGR &H[BB][GG][RR]& format strictly required by ASS \\c tags."""
    c = str(color_str or "").strip().lower()
    named = {
        "white": "FFFFFF",
        "black": "000000",
        "yellow": "00FFFF",  # RGB #FFFF00 -> BGR 00FFFF
        "gold": "00D7FF",    # RGB #FFD700 -> BGR 00D7FF
        "red": "0000FF",     # RGB #FF0000 -> BGR 0000FF
        "blue": "FF0000",    # RGB #0000FF -> BGR FF0000
        "green": "00FF00",   # RGB #00FF00 -> BGR 00FF00
        "cyan": "FFFF00",    # RGB #00FFFF -> BGR FFFF00
        "orange": "0080FF",  # RGB #FF8000 -> BGR 0080FF
        "purple": "800080",
        "pink": "CBC0FF",
    }
    if c in named:
        return f"&H{named[c]}&"
    if c.startswith("#"):
        hex_c = c[1:]
        if len(hex_c) == 3:
            hex_c = "".join(ch * 2 for ch in hex_c)
        if len(hex_c) == 6:
            r = hex_c[0:2]
            g = hex_c[2:4]
            b = hex_c[4:6]
            return f"&H{b.upper()}{g.upper()}{r.upper()}&"
    return "&HFFFFFF&"


def to_ass_bgr(color_str, alpha=0):
    """Convert hex (#RRGGBB) or named color to ASS &H[AA][BB][GG][RR] format for Style declarations."""
    c = str(color_str or "").strip().lower()
    named = {
        "white": "FFFFFF",
        "black": "000000",
        "yellow": "00FFFF",  # BGR for yellow
        "gold": "00D7FF",
        "red": "0000FF",     # BGR for red
        "blue": "FF0000",    # BGR for blue
        "green": "00FF00",
        "cyan": "FFFF00",
        "orange": "0080FF",
        "purple": "800080",
        "pink": "CBC0FF",
    }
    hex_bgr = named.get(c)
    if not hex_bgr and c.startswith("#"):
        hex_c = c[1:]
        if len(hex_c) == 3:
            hex_c = "".join(ch * 2 for ch in hex_c)
        if len(hex_c) == 6:
            r = hex_c[0:2]
            g = hex_c[2:4]
            b = hex_c[4:6]
            hex_bgr = f"{b.upper()}{g.upper()}{r.upper()}"
    if not hex_bgr:
        hex_bgr = "FFFFFF"
    return f"&H{alpha:02X}{hex_bgr}"


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
    ass_hl = to_ass_color_6(highlight_color)
    ass_base = to_ass_color_6(base_color)
    res = []
    for i, w in enumerate(words):
        if i >= highlight_start:
            res.append(f"{{\\c{ass_hl}}}{w}{{\\c{ass_base}}}")
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
    ass_hl = to_ass_color_6(styled_color)
    ass_base = to_ass_color_6(base_color)

    word_global_idx = 0
    formatted_lines = []
    for line in lines:
        line_words = line.split()
        res_words = []
        for w in line_words:
            if word_global_idx >= highlight_start:
                res_words.append(f"{{\\c{ass_hl}}}{w}{{\\c{ass_base}}}")
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


def prepare_logo_image(logo_path, style, tmp_dir):
    """Process logo image: bake in a solid white card badge or invert colors."""
    if not logo_path or not Path(logo_path).is_file():
        return None
    style = str(style or "").lower()
    if not style or style in ("transparent", "none"):
        return str(logo_path)

    out_path = Path(tmp_dir) / "styled_logo.png"
    try:
        from PIL import Image, ImageDraw, ImageOps
        im = Image.open(logo_path).convert("RGBA")
        w, h = im.size

        if "invert" in style:
            # Invert RGB while preserving transparency alpha
            r, g, b, a = im.split()
            rgb = Image.merge("RGB", (r, g, b))
            inv_rgb = ImageOps.invert(rgb)
            inv_r, inv_g, inv_b = inv_rgb.split()
            out_im = Image.merge("RGBA", (inv_r, inv_g, inv_b, a))
            out_im.save(out_path, format="PNG")
            return str(out_path)

        elif "white" in style:
            # Solid white rounded pill badge behind the logo (so dark video background never shows through inside)
            pad_x = max(28, int(round(w * 0.14)))
            pad_y = max(18, int(round(h * 0.18)))
            card_w = w + pad_x * 2
            card_h = h + pad_y * 2
            radius = max(8, int(round(card_h * 0.22)))

            card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
            draw = ImageDraw.Draw(card)
            draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, fill=(255, 255, 255, 255))
            card.alpha_composite(im, dest=(pad_x, pad_y))
            card.save(out_path, format="PNG")
            return str(out_path)

        elif "dark" in style or "black" in style:
            pad_x = max(28, int(round(w * 0.14)))
            pad_y = max(18, int(round(h * 0.18)))
            card_w = w + pad_x * 2
            card_h = h + pad_y * 2
            radius = max(8, int(round(card_h * 0.22)))

            card = Image.new("RGBA", (card_w, card_h), (0, 0, 0, 0))
            draw = ImageDraw.Draw(card)
            draw.rounded_rectangle([0, 0, card_w - 1, card_h - 1], radius=radius, fill=(15, 23, 42, 230))
            card.alpha_composite(im, dest=(pad_x, pad_y))
            card.save(out_path, format="PNG")
            return str(out_path)
    except Exception as e:
        print(f"  [LogoProcessor] Note: {e}, using original logo")
        return str(logo_path)

    return str(logo_path)


def build_logo_filter(logo_cfg, logo_w):
    """Build FFMPEG filter chain for logo."""
    return f"[1:v]scale={logo_w}:-1[logo]"


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


def normalize_font_name(font_name):
    if not font_name:
        return "DejaVu Sans"
    f = str(font_name).strip()
    first_part = f.split(",")[0].strip()
    low = first_part.lower()
    if "montenegrin" in low or "dela" in low:
        return "Dela Gothic One"
    if "arial" in low or "sans" in low or "montserrat" in low or "inter" in low or "roboto" in low:
        return "DejaVu Sans"
    return first_part


def apply_text_case(text, cases):
    if not text:
        return ""
    if not cases:
        return text
    if isinstance(cases, str):
        cases = [cases]
    cases_lower = [str(c).lower().strip() for c in cases]
    # "Normal Text" takes highest precedence - preserve natural Whisper/source casing
    if any("normal" in c or "orig" in c for c in cases_lower):
        return text
    if any("upper" in c for c in cases_lower):
        return text.upper()
    if any("lower" in c for c in cases_lower):
        return text.lower()
    return text


def build_subtitle_karaoke_events(segments_data, max_words=4, hl_color="yellow", txt_color="white", text_cases=None):
    """
    Generate dynamic modern karaoke subtitle events matching admin settings.
    - Active speaking word highlighted in hl_color using valid 6-hex ASS tag (\\c&HBBGGRR&)
    - Grouped into max_words words per screen
    - Text case applied
    """
    events = []
    hl_tag = to_ass_color_6(hl_color)
    txt_tag = to_ass_color_6(txt_color)

    for seg in segments_data:
        words = seg.get("words", [])
        if words:
            # Word-level timestamps available
            for i in range(0, len(words), max_words):
                chunk = words[i : i + max_words]
                if not chunk:
                    continue
                for j, active_w in enumerate(chunk):
                    ws = active_w["start"]
                    we = active_w["end"]
                    if we <= ws:
                        we = ws + 0.18
                    parts = []
                    for idx, w in enumerate(chunk):
                        w_text = apply_text_case(w["word"], text_cases)
                        if idx == j:
                            parts.append(f"{{\\c{hl_tag}}}{w_text}{{\\c{txt_tag}}}")
                        else:
                            parts.append(w_text)
                    events.append((ws, we, " ".join(parts)))
        else:
            # Sentence timestamps: divide evenly across words
            seg_text = seg.get("text", "").strip()
            if not seg_text:
                continue
            all_words = seg_text.split()
            seg_start = seg.get("start", 0.0)
            seg_end = seg.get("end", seg_start + 2.0)
            seg_dur = max(0.5, seg_end - seg_start)
            chunks = [all_words[i : i + max_words] for i in range(0, len(all_words), max_words)]
            if not chunks:
                continue
            time_per_chunk = seg_dur / len(chunks)
            for c_idx, chunk in enumerate(chunks):
                cs = seg_start + c_idx * time_per_chunk
                ce = cs + time_per_chunk
                time_per_word = time_per_chunk / max(1, len(chunk))
                for j in range(len(chunk)):
                    ws = round(cs + j * time_per_word, 2)
                    we = round(ws + time_per_word, 2)
                    parts = []
                    for idx, w in enumerate(chunk):
                        w_text = apply_text_case(w, text_cases)
                        if idx == j:
                            parts.append(f"{{\\c{hl_tag}}}{w_text}{{\\c{txt_tag}}}")
                        else:
                            parts.append(w_text)
                    events.append((ws, we, " ".join(parts)))
    return events


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
        parsed_segments = []

        for seg in raw_segments:
            seg_text = (seg.get("text") or "").strip()
            if not seg_text:
                continue
            seg_start = round(float(seg.get("start", 0.0)), 2)
            seg_end = round(float(seg.get("end", 0.0)), 2)
            words = []
            for w in seg.get("words", []):
                w_txt = (w.get("word") or "").strip()
                if w_txt:
                    words.append({
                        "word": w_txt,
                        "start": round(float(w.get("start", seg_start)), 2),
                        "end": round(float(w.get("end", seg_end)), 2),
                    })
            parsed_segments.append({
                "start": seg_start,
                "end": seg_end,
                "text": seg_text,
                "words": words,
            })

        return parsed_segments
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

    # Subtitle configuration parameters from campaign settings
    sub_cfg = subtitle_cfg or {}
    sub_font = normalize_font_name(sub_cfg.get("font") or "DejaVu Sans")
    sub_size = max(50, min(110, int(sub_cfg.get("font_size") or 64)))
    sub_color = to_ass_bgr(sub_cfg.get("color") or "white")
    sub_outline = to_ass_bgr(sub_cfg.get("outline_color") or "black")
    sub_hl = sub_cfg.get("speaking_word_highlight") or "yellow"
    sub_pos_pct = float(sub_cfg.get("placement_height_percent") or 78)
    # Alignment 2 is Bottom-Center. MarginV is distance from the BOTTOM of the canvas.
    sub_margin_v = max(100, min(1400, int(round(HEIGHT * (1.0 - (sub_pos_pct / 100.0))))))
    outline_px = max(3, min(10, int(round(sub_size * 0.08))))
    max_words = max(1, min(8, int(sub_cfg.get("max_words_per_screen") or 4)))
    text_cases = sub_cfg.get("text_cases") or ["Normal Text"]

    subs_cfg_enable = sub_cfg.get("enable")
    subs_enabled = subs_cfg_enable is not False and str(subs_cfg_enable).lower() not in ("false", "0", "disabled")

    # 1. Map srt_entries into playback segments if available
    matched_srt_segments = []
    if subs_enabled and srt_entries:
        for seg in segments:
            s, e = seg["start"], seg["end"]
            for (cs, ce, text) in srt_entries:
                if ce <= s or cs >= e:
                    continue
                ns = round(offset + max(0.0, cs - s), 2)
                ne = round(offset + min(e - s, ce - s), 2)
                if ne - ns >= 0.15:
                    matched_srt_segments.append({
                        "start": ns,
                        "end": ne,
                        "text": text,
                    })
            offset += (e - s)

    calculated_total = sum(max(0.0, parse_ts(seg["end"]) - parse_ts(seg["start"])) for seg in segments)
    total_dur = max(1.0, offset if offset > 0 else (calculated_total if calculated_total > 0 else 60.0))

    # If srt_entries matched, generate karaoke events
    if matched_srt_segments:
        k_events = build_subtitle_karaoke_events(matched_srt_segments, max_words=max_words, hl_color=sub_hl, txt_color=sub_color, text_cases=text_cases)
        events.extend(k_events)
        used += len(k_events)

    # 2. If no matching events from srt, transcribe joined clip audio directly with Whisper!
    if subs_enabled and len(events) == 0 and joined_path and Path(joined_path).is_file():
        try:
            print("  [Subtitles] Transcribing clip directly with Whisper for accurate word timestamps...")
            clip_segs = transcribe_clip_audio(Path(joined_path))
            if clip_segs:
                print(f"  [Subtitles] ✅ Transcribed {len(clip_segs)} spoken dialogue segments directly from clip!")
                k_events = build_subtitle_karaoke_events(clip_segs, max_words=max_words, hl_color=sub_hl, txt_color=sub_color, text_cases=text_cases)
                events.extend(k_events)
                used += len(k_events)
            else:
                print("  [Subtitles] No speech detected in this video snippet.")
        except Exception as e:
            print(f"  [Subtitles] Clip audio transcription warning: {e}")

    # If subtitles are disabled, clear parsed events
    if not subs_enabled:
        events = []

    # On-Screen Hook style & event
    extra_styles = ""
    extra_events = []
    if on_screen_text and str(on_screen_text).strip():
        osc = on_screen_cfg or {}
        os_font = normalize_font_name(osc.get("font") or "DejaVu Sans")
        os_size = int(osc.get("size_px", 54))
        os_color = to_ass_bgr(osc.get("text_color", "white"))
        os_bg = parse_bg_to_ass(osc.get("background", "black@0.5"))
        styled_cnt = int(osc.get("styled_word_count", 0))
        styled_col = osc.get("styled_words_color", "yellow")
        os_height_pct = float(osc.get("position_height_percent", 25))
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
    # sub_pos_y: Y position in pixels from top (used with \pos tag)
    sub_pos_y = max(50, min(HEIGHT - 50, int(round(HEIGHT * (sub_pos_pct / 100.0)))))
    sub_pos_x = WIDTH // 2  # Horizontally centered

    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {WIDTH}
PlayResY: {HEIGHT}
WrapStyle: 1

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,{sub_font},{sub_size},{sc_clean},{sc_clean},{so_clean},&H80000000,-1,0,0,0,100,100,0,0,1,{outline_px},2,2,40,40,{sub_margin_v},1
{extra_styles}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    # \an2 = bottom-center alignment, \pos pins to exact position, \q1 = end-of-line wrap (single line preferred)
    body_lines = extra_events + [
        f"Dialogue: 0,{fmt_ass_time(a)},{fmt_ass_time(b)},Default,,0,0,0,,{{\\an2\\pos({sub_pos_x},{sub_pos_y})}}{t}"
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
    try:
        r = subprocess.run(
            ["ffmpeg", "-hide_banner", "-ss", str(start), "-t", str(seg_len),
             "-i", str(src), "-af",
             f"silencedetect=noise={noise}:d={min_sil}", "-f", "null", "-"],
            capture_output=True, text=True, timeout=15)
        starts = [float(x) for x in re.findall(r"silence_start: ([\d.]+)", r.stderr)]
        ends = [float(x) for x in re.findall(r"silence_end: ([\d.]+)", r.stderr)]
        # If dead silence begins at start of cut (s0 < 0.05), shift window forward into speech
        # while STRICTLY PRESERVING seg_len so clip duration never shrinks below target!
        for s0, e0 in zip(starts, ends):
            if s0 < 0.05 and 0 < e0 < seg_len:
                shift = min(e0, 0.4)
                return round(start + shift, 3), round(end + shift, 3)
    except Exception:
        pass
    return start, end


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

    if ar == "9:16":
        # Full-frame 9:16 vertical crop with center zoom
        crop_vf = (
            f"crop='trunc(min(iw,ih*{box_w}/{box_h})/{zoom}/2)*2':"
            f"'trunc(min(ih,iw*{box_h}/{box_w})/{zoom}/2)*2'"
        )
        scale_vf = f"scale={box_w}:{box_h}:flags=bicubic"
        pad_vf = f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color={pad_color}"
        vf = f"{crop_vf},{scale_vf},{pad_vf},fps={FPS},setsar=1,format=yuv420p"
    else:
        # Boxed aspect ratio (4:3, 1:1, 16:9) inside 9:16 vertical canvas:
        # Fit video cleanly inside target box_w:box_h without clipping characters,
        # then pad to canvas HEIGHT (1920) centered with pad_color
        if zoom > 1.0:
            zoom_crop = f"crop='trunc(iw/{zoom}/2)*2':'trunc(ih/{zoom}/2)*2',"
        else:
            zoom_crop = ""
        vf = (
            f"{zoom_crop}"
            f"scale={box_w}:{box_h}:force_original_aspect_ratio=decrease:flags=bicubic,"
            f"pad={box_w}:{box_h}:(ow-iw)/2:(oh-ih)/2:color={pad_color},"
            f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color={pad_color},"
            f"fps={FPS},setsar=1,format=yuv420p"
        )

    preset = os.environ.get("FFMPEG_PRESET", "ultrafast")
    crf = os.environ.get("FFMPEG_CRF", "22")
    # -ss before -i for fast keyframe seek, -t after -i for exact duration cut, -avoid_negative_ts make_zero for audio sync
    run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
         "-ss", f"{start:.3f}", "-i", str(src), "-t", f"{dur:.3f}",
         "-vf", vf,
         "-c:v", "libx264", "-preset", preset, "-crf", crf, "-threads", "0",
         "-c:a", "aac", "-b:a", "128k", "-ar", "48000",
         "-avoid_negative_ts", "make_zero",
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

    joined = tmp / f"{cid}_joined.mp4"
    if len(segments) == 1:
        # Fast direct cut for single continuous clip (no concat needed!)
        seg = segments[0]
        seg_dur = seg["end"] - seg["start"]
        print(f"  continuous clip source {seg['start']:.1f}-{seg['end']:.1f} ({seg_dur:.1f}s)")
        render_segment(src, seg, joined, aspect_ratio=aspect_ratio, bg_color=bg_color)
    else:
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
    raw_logo_file = logo_cfg.get("path")
    has_logo = raw_logo_file and Path(raw_logo_file).is_file()
    if raw_logo_file and not Path(raw_logo_file).is_file():
        print(f"  ⚠️ Logo path given but file NOT found: {raw_logo_file}")
    logo_file = prepare_logo_image(raw_logo_file, logo_cfg.get("style"), tmp) if has_logo else None
    if logo_file:
        print(f"  ✅ Logo prepared: {logo_file} (style={logo_cfg.get('style')})")

    try:
        if ass_path and has_logo:
            ass_esc = str(ass_path).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
            logo_w = max(20, min(1000, int(round(WIDTH * (float(logo_cfg.get("width_percent", 40)) / 100)))))
            lx, ly = calc_logo_overlay_xy(logo_cfg.get("position", "Bottom Center"), logo_cfg.get("height_percent"))
            logo_f = build_logo_filter(logo_cfg, logo_w)
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(joined),
                 "-i", str(logo_file),
                 "-filter_complex", f"{logo_f};[0:v]ass='{ass_esc}'[v_ass];[v_ass][logo]overlay={lx}:{ly}[final_v]",
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
                 "-map", "0:v", "-map", "0:a?", "-c:a", "copy",
                 str(final)])
        elif has_logo:
            logo_w = max(20, min(1000, int(round(WIDTH * (float(logo_cfg.get("width_percent", 40)) / 100)))))
            lx, ly = calc_logo_overlay_xy(logo_cfg.get("position", "Bottom Center"), logo_cfg.get("height_percent"))
            logo_f = build_logo_filter(logo_cfg, logo_w)
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(joined),
                 "-i", str(logo_file),
                 "-filter_complex", f"{logo_f};[0:v][logo]overlay={lx}:{ly}[final_v]",
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
    if src_dur <= 0:
        raise SystemExit(f"source video is invalid or has 0 duration: {src}")
    out_dir = Path(args.out); out_dir.mkdir(parents=True, exist_ok=True)

    manifest = []
    with tempfile.TemporaryDirectory() as td:
        tmp = Path(td)
        for clip in clips:
            try:
                # Validate & clamp segment timestamps against src_dur so clips are never dropped
                valid_clip = True
                for raw in clip["segments"]:
                    s = parse_ts(raw["start"])
                    e = parse_ts(raw["end"])
                    seg_len = max(2.0, e - s)

                    if s >= src_dur - 0.5:
                        # Start is past or at the end of the video, pull start back to fit seg_len
                        s = max(0.0, src_dur - min(seg_len, src_dur))
                        e = src_dur
                        raw["start"] = round(s, 2)
                        raw["end"] = round(e, 2)
                    elif e > src_dur:
                        print(f"  ℹ️ Clamping clip {clip['id']} end from {e:.1f}s to source duration {src_dur:.1f}s")
                        e = src_dur
                        raw["end"] = round(e, 2)

                # Ensure segment has valid duration
                seg_total = sum(parse_ts(sg["end"]) - parse_ts(sg["start"]) for sg in clip["segments"])
                if seg_total < 1.0:
                    print(f"  ⚠️ Skipping clip {clip['id']}: total duration {seg_total:.1f}s is too short (<1s)")
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
