# whisper_live_realtime.py
import sounddevice as sd
import numpy as np
import whisper
import tempfile
import soundfile as sf
import time

SAMPLE_RATE = 16000
CHANNELS = 2
SLICE_DURATION = 1.5  # shorter for more "live" feeling

print("Loading Whisper model...")
model = whisper.load_model("tiny")  # try "base" if performance is good

def find_preferred_blackhole():
    devices = sd.query_devices()
    for idx, device in enumerate(devices):
        if "BlackHole 2ch" in device['name']:
            print(f"✅ Using BlackHole 2ch at device index {idx}")
            return idx
    for idx, device in enumerate(devices):
        if "BlackHole" in device['name']:
            print(f"⚠️ Using fallback BlackHole at device index {idx}")
            return idx
    raise RuntimeError("BlackHole device not found.")

device_index = find_preferred_blackhole()
print("🎧 Starting near-real-time transcription. Press Ctrl+C to stop.")

try:
    while True:
        recording = sd.rec(int(SLICE_DURATION * SAMPLE_RATE), samplerate=SAMPLE_RATE,
                           channels=CHANNELS, dtype='int16', device=device_index)
        sd.wait()

        mono_recording = np.mean(recording, axis=1).astype('int16')

        with tempfile.NamedTemporaryFile(suffix=".wav") as tmpfile:
            sf.write(tmpfile.name, mono_recording, SAMPLE_RATE, subtype='PCM_16')

            # Transcribe quickly with silence detection
            result = model.transcribe(
                tmpfile.name,
                fp16=False,
                no_speech_threshold=0.3,  # filter out dead air
                condition_on_previous_text=False
            )
            text = result["text"].strip()
            if text:
                print(f">>> {text}")
except KeyboardInterrupt:
    print("\n🛑 Transcription stopped.")
