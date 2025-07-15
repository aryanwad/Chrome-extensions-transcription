# live_transcribe_system_audio.py

import sounddevice as sd
import queue
import json
from vosk import Model, KaldiRecognizer

# -----------------------------
# CONFIG
SAMPLE_RATE = 16000
MODEL_PATH = "vosk-model-small-en-us-0.15"

# -----------------------------
# Load Vosk model
print("Loading Vosk model...")
model = Model(MODEL_PATH)
rec = KaldiRecognizer(model, SAMPLE_RATE)

# -----------------------------
# Setup audio queue
q = queue.Queue()

# -----------------------------
# Find BlackHole 2ch (preferred) or fallback
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
    raise RuntimeError(
        "\nCould not find a BlackHole device.\n"
        "Make sure you've installed BlackHole 2ch (recommended) or 16ch, "
        "and set up a Multi-Output Device in Audio MIDI Setup."
    )

device_index = find_preferred_blackhole()

# -----------------------------
# Audio callback to fill queue
def callback(indata, frames, time, status):
    if status:
        print(f"[Status]: {status}")
    q.put(bytes(indata))

# -----------------------------
# Main transcription loop
def main():
    print("Starting system audio capture...")
    transcript_log = []
    try:
        with sd.RawInputStream(samplerate=SAMPLE_RATE, blocksize=8000,
                               dtype='int16', channels=1,
                               callback=callback, device=device_index):
            print("Listening to system audio... (Ctrl+C to stop)")
            while True:
                data = q.get()
                if rec.AcceptWaveform(data):
                    result = json.loads(rec.Result())
                    text = result.get("text", "")
                    if text:
                        print(f">>> {text}")
                        transcript_log.append(text)
                else:
                    partial = json.loads(rec.PartialResult()).get("partial", "")
                    if partial:
                        print(f"\rPartial: {partial}", end="")
    except KeyboardInterrupt:
        print("\n--- Transcription session ended ---")
        print("Full transcript:")
        print("\n".join(transcript_log))

if __name__ == "__main__":
    main()
