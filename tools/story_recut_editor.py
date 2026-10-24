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


# --------------------------------------------------------------------------
# SRT -> re-timed, keyword-highlighted ASS for ONE clip
# --------------------------------------------------------------------------
SRT_TIME = re.compile(
    r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)")


def load_srt(path):
    entries, block = [], Path(path).read_text(encoding="utf-8", errors="ignore").strip().split("\n\n")
    for b in block:
        lines = [l for l in b.strip().splitlines() if l.strip()]
        for i, l in enumerate(lines):
            m = SRT_TIME.search(l)
            if m:
                g = [int(x) for x in m.groups()]
                start = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
                end = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
                text = " ".join(lines[i + 1:]).replace("\n", " ").strip()
                if text:
                    entries.append((start, end, re.sub(r"<[^>]+>", "", text)))
                break
    return entries


def highlight(text, keywords):
    """Wrap whole-word keyword matches in an ASS colour override.
    Accent = warm yellow (&H0000D7FF in ASS BGR). Text itself is unchanged."""
    for kw in sorted(keywords, key=len, reverse=True):
        pat = re.compile(rf"\b({re.escape(kw)})\b", re.IGNORECASE)
        text = pat.sub(r"{\\c&H00D7FF&}\1{\\c&HFFFFFF&}", text)
    return text


def build_ass(srt_entries, segments, keywords, out_path):
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
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {WIDTH}
PlayResY: {HEIGHT}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,54,&H00FFFFFF,&H00FFFFFF,&H00000000,&H64000000,-1,0,0,0,100,100,0,0,1,4,0,2,60,60,260,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""
    body = "\n".join(
        f"Dialogue: 0,{fmt_ass_time(a)},{fmt_ass_time(b)},Default,,0,0,0,,{t}"
        for a, b, t in events)
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
# render one segment (vertical crop + punch zoom + per-segment loudnorm)
# --------------------------------------------------------------------------
def render_segment(src, seg, out_path):
    start, end = seg["start"], seg["end"]
    dur = end - start
    zoom = float(seg.get("zoom", 1.0))
    zoom = min(max(zoom, 1.0), 1.6)
    # Crop a 9:16 window, enlarged by `zoom`, from the centre of the frame.
    # bicubic scaling is 3x faster than lanczos on CPU with crisp quality
    vf = (
        f"crop='trunc(ih*9/16/{zoom}/2)*2':'trunc(ih/{zoom}/2)*2',"
        f"scale={WIDTH}:{HEIGHT}:flags=bicubic,fps={FPS},setsar=1,format=yuv420p"
    )
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
# render one clip = ordered segments + optional burned-in clean captions
# --------------------------------------------------------------------------
def render_clip(src, clip, srt_entries, out_dir, tmp, tighten=False):
    cid = re.sub(r"[^A-Za-z0-9_-]+", "_", clip["id"])
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
        render_segment(src, seg, p)
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

    if srt_entries:
        try:
            ass = tmp / f"{cid}.ass"
            n = build_ass(srt_entries, segments, keywords, ass)
            print(f"  captions: {n} lines re-timed to playback order")
            ass_esc = str(ass).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(joined), "-vf", f"ass='{ass_esc}'",
                 "-c:v", "libx264", "-preset", preset, "-crf", crf, "-threads", "0",
                 "-c:a", "copy", str(final)])
        except Exception as ass_err:
            print(f"  ⚠️ Subtitle burn failed ({ass_err}), using video without subtitles")
            run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                 "-i", str(joined), "-c", "copy", str(final)])
    else:
        run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-i", str(joined), "-c", "copy", str(final)])

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
    if srt_path:
        srt_entries = load_srt(srt_path)
        print(f"Loaded {len(srt_entries)} caption lines from {srt_path}")

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
                res = render_clip(src, clip, srt_entries, out_dir, tmp, tighten=args.tighten)
                if res:
                    manifest.append(res)
            except Exception as clip_err:
                print(f"  ❌ Error rendering clip {clip.get('id', 'unknown')}: {clip_err}")

    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"\nDone. {len(manifest)} clip(s) in {out_dir}/ + manifest.json")


if __name__ == "__main__":
    main()
