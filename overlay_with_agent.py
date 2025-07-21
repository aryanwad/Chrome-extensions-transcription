import os
import tkinter as tk
from tkinter import scrolledtext
import threading
import queue
import sounddevice as sd
import numpy as np
import websocket
import json
from urllib.parse import urlencode
from datetime import datetime
from agent_utils import ask_question
from config import ASSEMBLYAI_API_KEY

# ───────── CONFIG ─────────
API_KEY = ASSEMBLYAI_API_KEY
CAPTURE_RATE = 48000
SEND_RATE = 16000
CHANNELS = 2
FRAMES_PER_BUF = int(0.05 * CAPTURE_RATE)
DOWN_FACTOR = CAPTURE_RATE // SEND_RATE
ARGS = {"sample_rate": SEND_RATE, "format_turns": True}
WS_URL = "wss://streaming.assemblyai.com/v3/ws?" + urlencode(ARGS)
TRANSCRIPT_FILE = "full_transcript.txt"
open(TRANSCRIPT_FILE, "w").close()

caption_q = queue.Queue(maxsize=1)
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
print(f"✅ Capturing from BlackHole (index {BH_INDEX}) at {CAPTURE_RATE} Hz")

def on_open(ws):
    print("🟢 WebSocket opened; streaming audio…")
    def audio_loop():
        def callback(indata, frames, *_):
            mono48 = np.mean(indata, axis=1)
            mono16 = mono48[::DOWN_FACTOR].astype(np.int16).tobytes()
            ws.send(mono16, websocket.ABNF.OPCODE_BINARY)
        with sd.InputStream(
            device=BH_INDEX,
            samplerate=CAPTURE_RATE,
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
    typ = data.get("type")
    if typ == "Begin":
        _enqueue(f"▶️ Session began: {data.get('id')}")
    elif typ == "Turn":
        txt = data.get("transcript", "")
        _enqueue(txt)
        if data.get("turn_is_formatted", False):
            _save(txt)
    elif typ == "Termination":
        dur = data.get("audio_duration_seconds", 0)
        _enqueue(f"⏹ Session ended after {dur:.2f}s")

def on_error(ws, error):
    print("🔴 WebSocket error:", error)
    stop_event.set()

def on_close(ws, code, msg):
    print(f"🔒 Connection closed (code={code}): {msg}")
    stop_event.set()

def _enqueue(text: str):
    if caption_q.full():
        _ = caption_q.get_nowait()
    caption_q.put(text)

def _save(text: str):
    ts = datetime.now().strftime("%H:%M:%S")
    line = f"[{ts}] {text}"
    with open(TRANSCRIPT_FILE, "a", encoding="utf-8") as f:
        f.write(line + "\n")

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
    # ───── Caption Overlay ─────
    caption_win = tk.Tk()
    caption_win.overrideredirect(True)
    caption_win.attributes("-topmost", True)
    caption_win.configure(bg="black")
    caption_win.attributes("-alpha", 0.85)
    
    # macOS specific: Set window level to float above fullscreen apps
    try:
        # Try multiple approaches for staying above fullscreen
        caption_win.call('tk::unsupported::MacWindowStyle', 'style', caption_win, 'utility', 'noTitleBar')
        caption_win.call('wm', 'attributes', caption_win, '-topmost', 1)
    except tk.TclError:
        pass  # Not on macOS or unsupported

    label = tk.Label(
        caption_win,
        text="…",
        font=("Helvetica", 36),
        fg="white",
        bg="black",
        justify="center",
        anchor="center",
        padx=20,
        pady=10
    )
    label.pack()

    # Create separate window for Ask Agent Button
    button_win = tk.Toplevel(caption_win)
    button_win.overrideredirect(True)
    button_win.attributes("-topmost", True)
    button_win.configure(bg="blue")
    button_win.attributes("-alpha", 0.9)
    
    # macOS specific: Set window level to float above fullscreen apps
    try:
        # Try multiple approaches for staying above fullscreen
        caption_win.call('tk::unsupported::MacWindowStyle', 'style', button_win, 'utility', 'noTitleBar')
        caption_win.call('wm', 'attributes', button_win, '-topmost', 1)
    except tk.TclError:
        pass  # Not on macOS or unsupported
    
    agent_button = tk.Button(
        button_win, text="Ask Agent", font=("Helvetica", 12),
        bg="blue", fg="white", command=lambda: ask_agent(caption_win),
        padx=10, pady=5
    )
    agent_button.pack()

    def place_agent_button():
        button_win.update_idletasks()
        screen_w = caption_win.winfo_screenwidth()
        screen_h = caption_win.winfo_screenheight()
        button_w = button_win.winfo_reqwidth()
        button_h = button_win.winfo_reqheight()
        # Position button in top-right corner with some margin
        x = screen_w - button_w - 20
        y = 20
        button_win.geometry(f"{button_w}x{button_h}+{x}+{y}")

    caption_win.after(100, place_agent_button)

    def ensure_topmost():
        """Periodically ensure overlays stay above fullscreen apps"""
        try:
            # More aggressive approach to stay above fullscreen
            caption_win.attributes("-topmost", False)
            button_win.attributes("-topmost", False)
            caption_win.attributes("-topmost", True)
            button_win.attributes("-topmost", True)
            caption_win.lift()
            button_win.lift()
            caption_win.focus_force()
            button_win.focus_force()
            
            # Try to reapply macOS window styles
            try:
                caption_win.call('wm', 'attributes', caption_win, '-topmost', 1)
                caption_win.call('wm', 'attributes', button_win, '-topmost', 1)
            except tk.TclError:
                pass
        except tk.TclError:
            pass  # Window might be destroyed
        caption_win.after(500, ensure_topmost)  # Check every 0.5 seconds

    caption_win.after(1000, ensure_topmost)

    def resize_caption_window():
        caption_win.update_idletasks()
        w = label.winfo_reqwidth()
        h = label.winfo_reqheight()
        x = (caption_win.winfo_screenwidth() - w) // 2
        y = caption_win.winfo_screenheight() - h - 150
        caption_win.geometry(f"{w}x{h}+{x}+{y}")

    def ask_agent(parent):
        input_popup = tk.Toplevel(parent)
        input_popup.title("Ask Agent")
        input_popup.geometry("500x400")
        input_popup.attributes("-topmost", True)

        tk.Label(input_popup, text="Ask a question:", font=("Helvetica", 14)).pack(pady=10)
        entry = tk.Entry(input_popup, width=50, font=("Helvetica", 12))
        entry.pack(pady=5)

        output_box = scrolledtext.ScrolledText(input_popup, wrap=tk.WORD, width=60, height=15, font=("Helvetica", 11))
        output_box.pack(pady=10)
        output_box.insert(tk.END, "AI response will appear here...\n")
        output_box.configure(state='disabled')

        def submit():
            question = entry.get().strip()
            if question:
                output_box.configure(state='normal')
                output_box.delete(1.0, tk.END)
                output_box.insert(tk.END, "Thinking...\n")
                output_box.configure(state='disabled')

                def call_agent():
                    try:
                        response = ask_question(question)
                        output_box.configure(state='normal')
                        output_box.delete(1.0, tk.END)
                        output_box.insert(tk.END, response)
                        output_box.configure(state='disabled')
                    except Exception as e:
                        output_box.configure(state='normal')
                        output_box.insert(tk.END, f"Error: {e}")
                        output_box.configure(state='disabled')

                threading.Thread(target=call_agent, daemon=True).start()

        tk.Button(input_popup, text="Submit", command=submit, bg="blue", fg="white", font=("Helvetica", 12)).pack()

    def poll():
        try:
            txt = caption_q.get_nowait()
            label.config(text=txt)
            resize_caption_window()
        except queue.Empty:
            pass
        caption_win.after(50, poll)

    caption_win.after(50, poll)
    caption_win.mainloop()


if __name__ == "__main__":
    threading.Thread(target=run_websocket, daemon=True).start()
    try:
        start_overlay()
    except KeyboardInterrupt:
        stop_event.set()
        print("🛑 Overlay closed.")
