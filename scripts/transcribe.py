#!/usr/bin/env python3
"""
transcribe.py — batch transcribe a WAV file using faster-whisper
Called by the Node.js SyncService after session stop.

Usage:
  python scripts/transcribe.py <wav_file> [--model base.en] [--language en]

Outputs JSON to stdout:
  { "segments": [{ "start": 0.0, "end": 2.5, "text": "...", "words": [...] }] }
"""

import sys
import json
import argparse
from pathlib import Path


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('wav_file', help='Path to WAV file')
    parser.add_argument('--model', default='base.en', help='Whisper model name')
    parser.add_argument('--language', default='en', help='Language code')
    args = parser.parse_args()

    wav_path = Path(args.wav_file)
    if not wav_path.exists():
        print(json.dumps({'error': f'File not found: {wav_path}'}))
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print(json.dumps({'error': 'faster-whisper not installed. Run: pip install faster-whisper'}))
        sys.exit(1)

    model = WhisperModel(args.model, device='cpu', compute_type='int8')
    segments_out = []

    segments, info = model.transcribe(
        str(wav_path),
        language=args.language,
        word_timestamps=True,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=500),
    )

    for seg in segments:
        words = [{'word': w.word, 'start': w.start, 'end': w.end} for w in (seg.words or [])]
        segments_out.append({
            'start': seg.start,
            'end': seg.end,
            'text': seg.text.strip(),
            'words': words,
        })

    print(json.dumps({'segments': segments_out, 'language': info.language}))


if __name__ == '__main__':
    main()
