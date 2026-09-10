#!/usr/bin/env python3
"""
Detect laughter segments in a .wav or .mp4 using Mega-Gorilla/laughter-detection
(fork of jrgillick/laughter-detection, Python 3.11-compatible).

Requires:
  - env LAUGHTER_DETECTION_ROOT = path to the cloned repo
  - ffmpeg on PATH (to extract 16kHz mono wav from mp4)

Usage:
  python laughter_detect.py <path-to-mp4-or-wav> [output-json-path]

Output JSON:
  { "events": [ { "start": 0.0, "end": 1.2, "confidence": 0.5 } ] }

Note: the upstream API returns (start, end) only — no per-segment probability.
confidence is set to the detector threshold used (schema field kept for callers).
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path


def extract_wav_16k_mono(media_path: Path, wav_path: Path) -> None:
    """Extract 16kHz mono PCM wav via ffmpeg (same target format Whisper expects)."""
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(media_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-c:a",
        "pcm_s16le",
        str(wav_path),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(
            f"ffmpeg failed extracting audio:\n{proc.stderr[-2000:]}"
        )


def load_detector(repo_root: Path, threshold: float, min_length: float):
    sys.path.insert(0, str(repo_root))
    # Import after path injection — package lives at repo root, not on pip
    from detector import LaughterDetector  # type: ignore

    model_path = repo_root / "checkpoints" / "in_use" / "resnet_with_augmentation"
    return LaughterDetector(
        model_path=str(model_path),
        config_name="resnet_with_augmentation",
        threshold=threshold,
        min_length=min_length,
    )


def main() -> int:
    if len(sys.argv) < 2:
        print(
            "Usage: laughter_detect.py <path-to-mp4-or-wav> [output-json-path]",
            file=sys.stderr,
        )
        return 1

    media_path = Path(sys.argv[1]).resolve()
    if not media_path.exists():
        print(f"File not found: {media_path}", file=sys.stderr)
        return 1

    out_path = (
        Path(sys.argv[2]).resolve()
        if len(sys.argv) >= 3
        else media_path.parent / "laughter.json"
    )

    repo = os.environ.get("LAUGHTER_DETECTION_ROOT", "").strip()
    if not repo:
        print(
            "LAUGHTER_DETECTION_ROOT is not set. Clone Mega-Gorilla/laughter-detection "
            "and set this env var to the repo root. See README prerequisites.",
            file=sys.stderr,
        )
        return 1

    repo_root = Path(repo).resolve()
    if not (repo_root / "detector.py").exists():
        print(
            f"LAUGHTER_DETECTION_ROOT does not look like the laughter-detection repo: {repo_root}",
            file=sys.stderr,
        )
        return 1

    threshold = float(os.environ.get("LAUGHTER_THRESHOLD", "0.5"))
    min_length = float(os.environ.get("LAUGHTER_MIN_LENGTH", "0.2"))

    tmp_wav: Path | None = None
    try:
        if media_path.suffix.lower() in {".wav"}:
            audio_path = media_path
        else:
            tmp_wav = Path(tempfile.mkstemp(suffix=".wav")[1])
            extract_wav_16k_mono(media_path, tmp_wav)
            audio_path = tmp_wav

        detector = load_detector(repo_root, threshold, min_length)
        # Upstream raises if instances>0 and output_dir is None — use a temp dir,
        # but skip writing laugh_*.wav clips.
        with tempfile.TemporaryDirectory(prefix="laughter_out_") as tmp_out:
            instances = detector.process_audio(
                audio_path=str(audio_path),
                output_dir=tmp_out,
                save_to_audio_files=False,
                save_to_textgrid=False,
            )

        events = []
        for inst in instances or []:
            start, end = float(inst[0]), float(inst[1])
            events.append(
                {
                    "start": start,
                    "end": end,
                    # Upstream returns (start, end) only — use configured threshold as proxy
                    "confidence": threshold,
                }
            )

        payload = {"events": events}
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        print(str(out_path))
        return 0
    except Exception as err:
        print(f"laughter_detect failed: {err}", file=sys.stderr)
        return 1
    finally:
        if tmp_wav is not None and tmp_wav.exists():
            try:
                tmp_wav.unlink()
            except OSError:
                pass


if __name__ == "__main__":
    raise SystemExit(main())
