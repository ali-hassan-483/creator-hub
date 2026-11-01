#!/usr/bin/env python3
"""
tools/transcribe_whisper.py

Offline audio speech-to-text transcription using local openai-whisper.
Extracts 16kHz mono audio from video, transcribes with word timestamps,
and writes both .json and .srt formats.
"""

import sys
import os
import re
import json
import subprocess
from pathlib import Path

def format_timestamp(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int(round((seconds % 1) * 1000))
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"

def transcribe(input_video_or_audio: str, output_json_path: str, model_name: str = "tiny") -> int:
    in_file = Path(input_video_or_audio)
    if not in_file.is_file():
        print(f"Input file not found: {in_file}", file=sys.stderr)
        return 1

    try:
        import whisper
    except ImportError:
        print("openai-whisper library is not installed in Python environment.", file=sys.stderr)
        return 2

    out_json = Path(output_json_path)
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_srt = out_json.with_suffix(".srt")

    # Step 1: Extract 16kHz mono WAV for fast whisper inference
    temp_wav = out_json.parent / f"{in_file.stem}_whisper_mono.wav"
    print(f"[Whisper] 🎵 Extracting 16kHz mono audio from {in_file.name}...")
    try:
        cmd_extract = [
            "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(in_file),
            "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
            str(temp_wav)
        ]
        subprocess.run(cmd_extract, check=True)
    except Exception as e:
        print(f"[Whisper] ❌ Failed to extract audio: {e}", file=sys.stderr)
        temp_wav = in_file  # Try passing original file if ffmpeg failed

    # Step 2: Load Whisper model and transcribe
    try:
        print(f"[Whisper] 🏃 Loading Whisper '{model_name}' model on CPU...")
        model = whisper.load_model(model_name)
        print(f"[Whisper] 🎙️ Transcribing speech...")
        result = model.transcribe(str(temp_wav), word_timestamps=True, verbose=False)

        raw_segments = result.get("segments", [])
        segments = []
        srt_lines = []

        for idx, seg in enumerate(raw_segments):
            text = seg.get("text", "").strip()
            if not text:
                continue
            start = round(float(seg.get("start", 0.0)), 2)
            end = round(float(seg.get("end", 0.0)), 2)
            words = []
            for w in seg.get("words", []):
                word_txt = w.get("word", "").strip()
                if word_txt:
                    words.append({
                        "word": word_txt,
                        "start": round(float(w.get("start", start)), 2),
                        "end": round(float(w.get("end", end)), 2)
                    })

            segments.append({
                "text": text,
                "start": start,
                "end": end,
                "words": words
            })

            # Prepare SRT entry
            srt_lines.append(f"{idx + 1}\n{format_timestamp(start)} --> {format_timestamp(end)}\n{text}\n")

        # Save JSON output
        out_json.write_text(json.dumps(segments, indent=2), encoding="utf-8")
        # Save SRT output alongside
        out_srt.write_text("\n".join(srt_lines) + "\n", encoding="utf-8")

        print(f"[Whisper] ✅ Successfully transcribed {len(segments)} segments into {out_json.name} and {out_srt.name}")
        return 0

    except Exception as e:
        print(f"[Whisper] ❌ Transcription error: {e}", file=sys.stderr)
        return 3
    finally:
        # Cleanup temporary audio
        if temp_wav != in_file and temp_wav.exists():
            try: temp_wav.unlink()
            except: pass

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python transcribe_whisper.py <input_video_path> <output_json_path> [model_name]")
        sys.exit(1)

    target_model = sys.argv[3] if len(sys.argv) > 3 else os.environ.get("WHISPER_MODEL", "tiny")
    code = transcribe(sys.argv[1], sys.argv[2], target_model)
    sys.exit(code)
