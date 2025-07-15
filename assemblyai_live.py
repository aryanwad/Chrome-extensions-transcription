import sounddevice as sd
import numpy as np
import websocket
import json
import threading
import time
from urllib.parse import urlencode
from datetime import datetime

# ─────────────── CONFIG ───────────────
API_KEY         = "d075180583e743dc84435b50f422373b"   # ← replace with your key
SAMPLE_RATE     = 16000
CHANNELS        = 2
FRAMES_PER_BUF  = 1024                        # ~0.064s at 16 kHz
# Turn on format_turns to get nicely punctuated sentences
ARGS = {"sample_rate": SAMPLE_RATE, "format_turns": True}
WS_URL = "wss://streaming.assemblyai.com/v3/ws?" + urlencode(ARGS)

stop_event = threading.Event()


def find_blackhole():
    """Find the system‑audio BlackHole device index."""
    for idx, dev in enumerate(sd.query_devices()):
        if "BlackHole 2ch" in dev["name"]:
            return idx
    for idx, dev in enumerate(sd.query_devices()):
        if "BlackHole" in dev["name"]:
            return idx
    raise RuntimeError("BlackHole device not found. Install & configure Multi‑Output.")


BH_INDEX = find_blackhole()
print(f"✅ Capturing from BlackHole (index {BH_INDEX})")


def on_open(ws):
    print("🟢 WebSocket opened. Streaming system audio…")

    def audio_loop():
        def callback(indata, frames, t0, status):
            if status:
                print("⚠️ Audio status:", status)
            # downmix stereo → mono int16
            mono = np.mean(indata, axis=1).astype(np.int16).tobytes()
            ws.send(mono, websocket.ABNF.OPCODE_BINARY)

        with sd.InputStream(
            device=BH_INDEX,
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
            blocksize=FRAMES_PER_BUF,
            callback=callback,
        ):
            stop_event.wait()
        print("🔈 Audio stream stopped.")

    threading.Thread(target=audio_loop, daemon=True).start()


def on_message(ws, message):
    data = json.loads(message)
    t = data.get("type")
    if t == "Begin":
        print(f"▶️ Session began: {data.get('id')}")
    elif t == "Turn":
        txt = data.get("transcript", "")
        if data.get("turn_is_formatted", False):
            # overwrite the previous line for a clean sentence
            print("\r" + txt)
        else:
            # partial result
            print("\r" + txt, end="")
    elif t == "Termination":
        dur = data.get("audio_duration_seconds", 0)
        print(f"\n⏹ Session ended after {dur:.2f}s")


def on_error(ws, error):
    print("🔴 WebSocket error:", error)
    stop_event.set()


def on_close(ws, code, msg):
    print(f"🔒 Connection closed (code={code}):", msg)
    stop_event.set()


if __name__ == "__main__":
    ws = websocket.WebSocketApp(
        WS_URL,
        header={"Authorization": API_KEY},
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )

    wst = threading.Thread(target=ws.run_forever, daemon=True)
    wst.start()

    try:
        while wst.is_alive():
            time.sleep(0.1)
    except KeyboardInterrupt:
        print("\n🛑 Stopping…")
        stop_event.set()
        # politely tell AssemblyAI we’re done
        try:
            ws.send(json.dumps({"type": "Terminate"}))
            time.sleep(0.5)
        except:
            pass
        ws.close()
        wst.join()

    print("✔️ Exited cleanly.")
