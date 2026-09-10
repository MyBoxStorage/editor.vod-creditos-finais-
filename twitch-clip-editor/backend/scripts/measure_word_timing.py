"""Measure whisper word timing vs audio energy onset (proxy accuracy)."""
import json
import subprocess
import wave
import struct
import math
from pathlib import Path

WAV = Path(__file__).resolve().parents[1] / "data" / "v2820282061" / "transcripts" / "33aa1a6d-c06c-4d38-b0c2-936d3dc154e6.wav"
TRANSCRIPT = Path(__file__).resolve().parents[1] / "data" / "_val_frames" / "fresh_transcript.json"

if not WAV.exists():
    preview = Path(__file__).resolve().parents[1] / "data" / "v2820282061" / "previews" / "33aa1a6d-c06c-4d38-b0c2-936d3dc154e6.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-i", str(preview), "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", str(WAV)
    ], check=True)

data = json.loads(TRANSCRIPT.read_text(encoding="utf-8"))
words = []
for seg in data["segments"]:
    words.extend(seg.get("words") or [])

with wave.open(str(WAV), "rb") as wf:
    rate = wf.getframerate()
    frames = wf.readframes(wf.getnframes())
    samples = struct.unpack(f"<{len(frames)//2}h", frames)

def energy_onset(t_start: float, t_end: float) -> float:
    i0 = max(0, int(t_start * rate))
    i1 = min(len(samples), int(t_end * rate))
    window =  int(0.02 * rate)
    best_i = i0
    best_e = 0.0
    for i in range(i0, max(i0 + 1, i1 - window), max(1, window // 4)):
        e = sum(abs(samples[j]) for j in range(i, min(i + window, len(samples))))
        if e > best_e:
            best_e = e
            best_i = i
    return best_i / rate

deviations = []
for w in words[:10]:
    word = w["word"].strip()
    if not word:
        continue
    onset = energy_onset(w["start"], min(w["end"], w["start"] + 0.25))
    dev_ms = abs(onset - w["start"]) * 1000
    deviations.append(dev_ms)
    print(f"{word:12} whisper={w['start']:.3f}s energy={onset:.3f}s dev={dev_ms:.0f}ms")

avg = sum(deviations) / len(deviations) if deviations else 0
print(f"\nAverage deviation: {avg:.1f} ms over {len(deviations)} words")
