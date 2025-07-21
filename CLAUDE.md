# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a live transcription application that captures system audio and provides real-time transcription with an AI assistant overlay. The system consists of:

1. **Audio capture** from system output (using BlackHole on macOS or VB-Cable on Windows)
2. **Real-time transcription** via AssemblyAI WebSocket streaming
3. **GUI overlay** displaying live captions with transparent background
4. **AI assistant integration** with OpenAI GPT-4 for transcript-based interactions
5. **Persistent transcript logging** to `full_transcript.txt`

## Key Files

- `overlay_with_agent.py` - Main application entry point containing:
  - Audio capture from BlackHole device
  - WebSocket connection to AssemblyAI
  - Tkinter GUI overlay for captions
  - "Ask Agent" button with popup interface
- `agent_utils.py` - OpenAI integration utilities providing:
  - `ask_question()` - Query AI about transcript content
  - `summarize_transcript()` - Generate transcript summaries
  - `draft_followup_email()` - Create follow-up emails from transcript
- `full_transcript.txt` - Auto-generated transcript file with timestamps

## Dependencies

Install required packages:
```bash
pip install sounddevice numpy websocket-client openai
```

## Audio Setup

### macOS (BlackHole)
1. Install BlackHole: https://existential.audio/blackhole/
2. Set system output to BlackHole or create Multi-Output Device
3. Application auto-detects BlackHole device on startup

### Windows (VB-Cable)
1. Install VB-Cable: https://vb-audio.com/Cable/
2. Set system output to VB-Cable
3. Modify `find_blackhole()` function to detect VB-Cable device

## Running the Application

```bash
python overlay_with_agent.py
```

## Configuration

### Audio Settings
- `CAPTURE_RATE = 48000` - Audio capture sample rate
- `SEND_RATE = 16000` - Rate sent to AssemblyAI
- `CHANNELS = 2` - Stereo audio capture
- `FRAMES_PER_BUF` - Buffer size for audio processing

### API Keys
- API keys are stored in `config.py` file
- AssemblyAI API key: `ASSEMBLYAI_API_KEY`
- OpenAI API key: `OPENAI_API_KEY`

**SECURITY NOTE**: The `config.py` file is excluded from git via `.gitignore` to prevent API key exposure.

## Architecture

The application uses a multi-threaded architecture:

1. **Main Thread**: Runs Tkinter GUI overlay
2. **WebSocket Thread**: Handles AssemblyAI streaming connection
3. **Audio Thread**: Captures system audio and streams to WebSocket
4. **Agent Thread**: Processes AI requests asynchronously

Data flows through:
- Audio capture → WebSocket → AssemblyAI → Caption queue → GUI display
- Completed transcripts → File logging → AI agent context

## GUI Components

- **Caption Overlay**: Auto-resizing window showing live transcription
- **Ask Agent Button**: Persistent button for AI interactions
- **Agent Popup**: Multi-functional interface with:
  - Question input field
  - Scrollable response area
  - Asynchronous processing

## Development Notes

- No formal testing framework currently implemented
- No linting configuration present
- Uses direct pip install approach (no requirements.txt)
- Python 3.9+ required for modern type hints and features
- GUI uses Tkinter (included with Python)

## Common Issues

- **BlackHole not found**: Ensure BlackHole is installed and properly configured
- **WebSocket connection fails**: Check AssemblyAI API key and network connectivity
- **No audio capture**: Verify system audio output is routed through BlackHole
- **AI responses fail**: Check OpenAI API key and network access