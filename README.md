# Live Transcription App

## 🚀 Project Objective

Enable users to receive **live, accurate, and context-aware transcriptions** from any audio source—such as YouTube Live, Twitch, Google Meet, Zoom, Discord, and more—and interact with a powerful AI assistant via a modern GUI overlay or browser extension.

---

## 🧠 How It Works

The system:

1. **Captures system audio output** (from speakers, headphones, AirPods, etc.).
2. Streams audio to **AssemblyAI** for real-time transcription.
3. Displays transcriptions as an overlay on the screen with a sleek, auto-sizing GUI.
4. Writes finalized transcriptions **sentence-by-sentence** to a `full_transcript.txt` file.
5. Lets users interact with an embedded **AI Agent** via a persistent "Ask Agent" button with a multi-tab pop-up UI.

This tool will eventually exist in two forms:

* ✅ **Standalone desktop app** (macOS ✅, Windows ✅, Linux planned)
* 🔜 **Google Chrome Extension** (for browser-based streams, tab-only capture, or simplified access)

The app is currently optimized for **macOS** using the **BlackHole** virtual audio device, but cross-platform support (e.g., VB-Cable for Windows) is being integrated for broader accessibility.

---

## 🧰 Key Features

### ✅ 1. Live Transcription

* Real-time subtitle overlay for all desktop audio
* Cross-app compatibility (Zoom, Meet, YouTube, Spotify, Twitch, etc.)
* Works with any speaker output (BlackHole on macOS, VB-Cable on Windows)
* Adjustable font, position, and transparency for the GUI overlay

### ✅ 2. Persistent Ask Agent Button

* Floating button **always visible on screen** (topmost, right-aligned)
* Opens an AI assistant with the following tabs:

  #### 🧠 Tabs in Agent UI

  * **Ask a Question**: Type and ask anything based on the transcript context
  * **Auto Summary**: Agent generates an intelligent summary of the full transcript
  * **Quick Highlights** *(coming soon)*: Extracts relevant key points
  * **Reminders/Follow-ups** *(planned)*: Suggests next steps from meeting/talk

### ✅ 3. Transcript File Logging

* Every finalized caption is stored to a file (`full_transcript.txt`)
* This file is fed to the AI agent for full-context understanding
* Stored with timestamps in `[HH:MM:SS]` format

### ✅ 4. Lightweight & CPU-Friendly

* All captioning is streamed using **AssemblyAI’s real-time API**, so minimal compute load
* Works even on low-spec machines
* Clean separation of backend logic (WebSocket + capture) and frontend GUI

### ✅ 5. Modern Overlay GUI

* Tkinter-based overlay for desktop captions
* Automatically resizes around spoken words
* Transparent, clean subtitle background (not full-width)
* Adjustable size, alignment, and padding

---

## 💰 Monetization & Differentiation

The livestream captioning space is **not saturated**. This product is uniquely positioned for:

* 🔥 **Viral growth** through accessibility, captions, and AI assistant
* 📈 **Ads & Sponsorships** inside the app or Chrome extension
* 💼 **Enterprise / Educator tier** for meeting auto-logging + summaries
* 📊 **SEO Boost** by allowing YouTubers to extract transcripts for blog conversion
* 🧩 **Plugin ecosystem** (export to Notion, generate calendar notes, sync with Slack, etc.)

---

## 🖥️ Developer Architecture

```
+--------------------+         +---------------------+
|  System Audio In   |  --->   |  AssemblyAI WebSocket|
+--------------------+         +---------------------+
                                     |
                                     v
                            +-------------------+
                            | Caption Queue     |
                            +-------------------+
                                     |
         +----------------------------+---------------------------+
         |                            |                           |
+-----------------+     +--------------------------+   +-------------------------+
| Caption Overlay |     | Transcript Logging File  |   | AI Agent Popup (GUI)   |
| (Tkinter GUI)   |     | `full_transcript.txt`    |   | - Ask
+-----------------+     +--------------------------+   | - Summary
                                                       | - [Future: Highlights]
                                                       +-------------------------+
```

---

## ⚙️ Developer Setup

### 🧪 Prerequisites

* Python 3.9+
* Tkinter (usually included with Python)
* AssemblyAI API key
* `sounddevice`, `numpy`, `websocket-client`
* `BlackHole` (macOS) or `VB-Cable` (Windows) for audio capture

### 📦 Install

```bash
pip install sounddevice numpy websocket-client
```

### 🎧 macOS (via BlackHole)

1. Install BlackHole: [https://existential.audio/blackhole/](https://existential.audio/blackhole/)
2. Set system output to BlackHole
3. Open Audio MIDI Setup and create Multi-Output Device (for dual playback + capture)

### 🪟 Windows (via VB-Cable)

1. Install VB-Cable: [https://vb-audio.com/Cable/](https://vb-audio.com/Cable/)
2. Set system output to VB-Cable
3. Select VB-Cable as your default recording source

### ▶️ Run

```bash
python overlay_agent.py
```

(Or your modified entry point script.)

---

## 🔮 Planned Features

* 🎞️ Clip detection (highlight viral or key moments automatically)
* 📅 Smart meeting recaps (auto-generate calendar entries)
* 📌 Chrome Extension Integration
* 🧩 Plugin support for Notion, Slack, Discord, Zoom, etc.

---

## 🙌 Credits

* Transcription via [AssemblyAI](https://www.assemblyai.com/)
* GUI overlay with `tkinter`
* System audio capture via `sounddevice`, BlackHole/VB-Cable

---

## 🧑‍💻 Project Owner

**Aryan Wadhwa** — Building an open, accessible, real-time transcription and assistant platform for the world.

Open to contributors, testers, and designers. Stay tuned for GitHub repo link!

---

## 🗂 Repo Structure (coming soon)

```
/live_transcriber
├── overlay_agent.py          # main entry point
├── agent_utils.py            # OpenAI/LLM interface logic
├── full_transcript.txt       # saved real-time transcript
├── assets/                   # (optional) branding, logos, etc.
├── README.md                 # this file
└── ...
```

---

## 🏁 Final Thoughts

This app is designed to be:

* 📺 Useful for creators
* 🧑‍💼 Powerful for professionals
* 🎓 Accessible for students
* 🦾 Smart for everyone

Let your audio speak — and let your captions think.

---

*Questions? Feature ideas? Bug reports? Contact Aryan directly or submit a GitHub issue once live.*
