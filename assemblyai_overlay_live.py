# assemblyai_overlay_live_partial_vs_terminal.py

import sounddevice as sd
import numpy as np
import websocket
import json
import threading
import queue
import tkinter as tk
import time
from urllib.parse import urlencode
from datetime import datetime

# ───────── CONFIG ─────────
API_KEY        = "d075180583e743dc84435b50f422373b"
SAMPLE_RATE    = 16000
CHANNELS       = 2
FRAMES_PER_BUF = 1024
ARGS           = {"sample_rate": SAMPLE_RATE, "format_turns": True}
WS_URL         = "wss://streaming.assemblyai.com/v3/ws?" + urlencode(ARGS)

caption_q  = queue.Queue(maxsize=1)
stop_event = threading.Event()

def find_blackhole():
    for i, dev in enumerate(sd.query_devices()):
        if "BlackHole 2ch" in dev["name"]:
            return i
    for i, dev in enumerate(sd.query_devices()):
        if "BlackHole" in dev["name"]:
            return i
    raise RuntimeError("BlackHole device not found.")
BH_INDEX = find_blackhole()
print(f"✅ Capturing from BlackHole (index {BH_INDEX})")

def on_open(ws):
    print("🟢 WebSocket opened. Streaming system audio…")
    def audio_loop():
        def callback(indata, frames, *_):
            if frames == 0: return
            mono = np.mean(indata, axis=1).astype(np.int16).tobytes()
            ws.send(mono, websocket.ABNF.OPCODE_BINARY)

        with sd.InputStream(
            device=BH_INDEX,
            samplerate=SAMPLE_RATE,
            channels=CHANNELS,
            dtype="int16",
            blocksize=FRAMES_PER_BUF,
            callback=callback
        ):
            stop_event.wait()
    threading.Thread(target=audio_loop, daemon=True).start()

def on_message(ws, message):
    data = json.loads(message)
    t = data.get("type")
    if t == "Begin":
        txt = f"▶️ Session began: {data.get('id')}"
    elif t == "Turn":
        txt = data.get("transcript", "")
        # if it's a final turn, clear any partial
        # our overlay just replaces the text every time
    elif t == "Termination":
        dur = data.get("audio_duration_seconds", 0)
        txt = f"⏹ Session ended after {dur:.2f}s"
    else:
        return

    # enqueue latest caption
    if caption_q.full():
        _ = caption_q.get_nowait()
    caption_q.put(txt)

def on_error(ws, error):
    print("🔴 WebSocket error:", error)
    stop_event.set()

def on_close(ws, code, msg):
    print(f"🔒 Connection closed (code={code}): {msg}")
    stop_event.set()

def run_websocket():
    ws = websocket.WebSocketApp(
        WS_URL,
        header={"Authorization": API_KEY},
        on_open=on_open,
        on_message=on_message,
        on_error=on_error,
        on_close=on_close,
    )
    ws.run_forever()

def start_overlay():
    root = tk.Tk()
    root.overrideredirect(True)
    root.attributes("-topmost", True)
    root.configure(bg="black")
    root.attributes("-alpha", 0.7)

    label = tk.Label(
        root,
        text="…",
        font=("Helvetica", 28),
        fg="white",
        bg="black",
        wraplength=root.winfo_screenwidth() - 100,
        justify="center",
    )
    label.pack(padx=10, pady=10)

    w = root.winfo_screenwidth() - 100
    h = 60
    x = 50
    y = root.winfo_screenheight() - h - 150
    root.geometry(f"{w}x{h}+{x}+{y}")

    def poll():
        try:
            txt = caption_q.get_nowait()
            label.config(text=txt)
        except queue.Empty:
            pass
        root.after(50, poll)

    root.after(50, poll)
    root.mainloop()

if __name__ == "__main__":
    threading.Thread(target=run_websocket, daemon=True).start()
    try:
        start_overlay()
    except KeyboardInterrupt:
        stop_event.set()
        print("🛑 Overlay closed.")
