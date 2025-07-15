# test_record_blackhole.py
import sounddevice as sd
import numpy as np
import soundfile as sf
import os

SAMPLE_RATE = 16000
CHANNELS = 2
SECONDS = 3

def find_blackhole_index():
    for idx, device in enumerate(sd.query_devices()):
        if "BlackHole 2ch" in device['name'] or "BlackHole" in device['name']:
            return idx
    raise RuntimeError("BlackHole not found in device list.")

device_index = find_blackhole_index()
print(f"✅ Recording from BlackHole device index: {device_index}")

print(f"🎙 Recording {SECONDS} seconds from system audio...")
recording = sd.rec(int(SECONDS * SAMPLE_RATE), samplerate=SAMPLE_RATE,
                   channels=CHANNELS, dtype='int16', device=device_index)
sd.wait()

# Downmix to mono for easy playback
mono_recording = np.mean(recording, axis=1).astype('int16')

# Save to file
filename = "blackhole_test.wav"
sf.write(filename, mono_recording, SAMPLE_RATE, subtype='PCM_16')
print(f"✅ Saved recording to {filename}")

# Play back through your default speakers
print("🔊 Playing back the captured audio...")
sd.play(mono_recording, samplerate=SAMPLE_RATE)
sd.wait()
print("✅ Playback done.")
