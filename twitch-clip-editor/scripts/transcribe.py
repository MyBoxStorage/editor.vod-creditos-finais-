#!/usr/bin/env python3
"""Transcribe an audio/video file with faster-whisper (word-level timestamps)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Register NVIDIA CUDA DLL dirs on Windows BEFORE importing faster_whisper/ctranslate2.
# Optional overrides: NVIDIA_DLL_CUBLAS_DIR, NVIDIA_DLL_CUDNN_DIR
if os.name == "nt":
    _default_cublas = r"C:\Users\pc\AppData\Local\Programs\Python\Python312\Lib\site-packages\nvidia\cublas\bin"
    _default_cudnn = r"C:\Users\pc\AppData\Local\Programs\Python\Python312\Lib\site-packages\nvidia\cudnn\bin"
    _cublas_dir = os.environ.get("NVIDIA_DLL_CUBLAS_DIR", _default_cublas)
    _cudnn_dir = os.environ.get("NVIDIA_DLL_CUDNN_DIR", _default_cudnn)
    for _dir in (_cublas_dir, _cudnn_dir):
        if os.path.isdir(_dir):
            os.add_dll_directory(_dir)


def _resolve_device_and_compute_type() -> tuple[str, str]:
    device = os.environ.get("WHISPER_DEVICE", "cuda").strip().lower() or "cuda"
    compute_type_env = os.environ.get("WHISPER_COMPUTE_TYPE", "").strip()
    if compute_type_env:
        compute_type = compute_type_env
    elif device == "cuda":
        compute_type = "float16"
    else:
        compute_type = "int8"
    return device, compute_type


def _load_model(model_name: str, WhisperModel):  # type: ignore[no-untyped-def]
    device, compute_type = _resolve_device_and_compute_type()
    try:
        print(
            f"[transcribe] usando device={device} compute_type={compute_type} model={model_name}",
            flush=True,
        )
        return WhisperModel(model_name, device=device, compute_type=compute_type)
    except Exception as err:
        if device == "cpu":
            raise
        print(
            f"[transcribe] GPU indisponível, caindo para CPU: {err}",
            flush=True,
        )
        print(
            "[transcribe] usando device=cpu compute_type=int8",
            flush=True,
        )
        return WhisperModel(model_name, device="cpu", compute_type="int8")


def main() -> int:
    import argparse

    parser = argparse.ArgumentParser(description="Transcribe media with word timestamps")
    parser.add_argument("media_path", help="Path to mp4/wav")
    parser.add_argument("output_path", nargs="?", help="Output JSON path")
    parser.add_argument("--start", type=float, default=None, help="Segment start (s)")
    parser.add_argument("--end", type=float, default=None, help="Segment end (s)")
    parser.add_argument("--prompt", type=str, default=None, help="Initial prompt / reference text")
    args = parser.parse_args()

    media_path = Path(args.media_path).resolve()
    if not media_path.exists():
        print(f"File not found: {media_path}", file=sys.stderr)
        return 1

    if args.output_path:
        out_path = Path(args.output_path).resolve()
    else:
        out_path = media_path.parent / "transcript.json"

    model_name = os.environ.get("WHISPER_MODEL", "medium")

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(
            "faster-whisper is not installed. Run: pip install faster-whisper",
            file=sys.stderr,
        )
        return 1

    model = _load_model(model_name, WhisperModel)

    transcribe_kwargs: dict = {"word_timestamps": True}
    if args.prompt:
        transcribe_kwargs["initial_prompt"] = args.prompt
    if args.start is not None:
        transcribe_kwargs["clip_timestamps"] = (
            [args.start] if args.end is None else [args.start, args.end]
        )

    segments_iter, _info = model.transcribe(str(media_path), **transcribe_kwargs)

    segments = []
    for segment in segments_iter:
        words = []
        if segment.words:
            for w in segment.words:
                words.append(
                    {
                        "word": w.word,
                        "start": float(w.start),
                        "end": float(w.end),
                    }
                )
        segments.append(
            {
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text.strip(),
                "words": words,
            }
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"segments": segments}
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(str(out_path))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
