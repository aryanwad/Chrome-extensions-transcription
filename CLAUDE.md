# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **Chrome Extension** for live transcription that captures browser tab audio and provides real-time transcription with an overlay. The system consists of:

1. **Chrome Tab Capture** using Manifest V3 with `chrome.tabCapture.getMediaStreamId()`
2. **Offscreen Document** for audio processing (Chrome 116+ approach)
3. **Real-time transcription** via AssemblyAI v3 WebSocket streaming
4. **Browser overlay** displaying live captions on web pages
5. **AI assistant integration** with OpenAI GPT-4 for transcript-based interactions

## Key Chrome Extension Files

### Core Files
- `manifest.json` - Manifest V3 configuration with tabCapture and offscreen permissions
- `background.js` - Service worker handling WebSocket connections to AssemblyAI v3
- `popup.js` - Extension popup for user interaction and `chrome.tabCapture.getMediaStreamId()`
- `popup.html` - Extension popup interface
- `content.js` - Content script for overlay display on web pages
- `content-audio.js` - Legacy content script (now minimal, actual capture in offscreen)
- `offscreen.js` - Offscreen document handling audio capture and PCM16 conversion
- `offscreen.html` - Offscreen document HTML
- `overlay.css` - Styling for the transcription overlay

### Deprecated Python Files (Not Used)
- `overlay_with_agent.py` - Old Python implementation (replaced by Chrome extension)
- `agent_utils.py` - Old Python utilities (functionality moved to background.js)

## Current Implementation Status (as of 2025-07-21)

### ✅ WORKING COMPONENTS:
1. **Chrome Tab Capture**: Successfully captures audio from browser tabs
   - User clicks extension → `getMediaStreamId()` works
   - No tab picker required (seamless UX)
   - Audio stops playing in tab (confirms capture working)

2. **AssemblyAI v3 Connection**: WebSocket connects successfully
   - Proper authentication with token in URL
   - Receives "Begin" messages from AssemblyAI
   - WebSocket state shows as OPEN

3. **Extension Infrastructure**: All components load properly
   - Service worker starts without errors
   - Content scripts inject successfully
   - Popup interface works
   - Offscreen document created

4. **Overlay System**: Content script overlay displays correctly
   - Shows test messages ("Test transcript - if you see this, the overlay system works!")
   - Overlay appears/hides properly
   - Stop button functional

### ❌ CURRENT ISSUE:
**Audio Processing in Offscreen Document**: The main problem is in `offscreen.js`
- Audio capture appears to work (YouTube audio stops playing)
- But no audio data is being processed and sent to AssemblyAI
- No "Turn" messages received from AssemblyAI (only "Begin")
- No live transcription text appearing in overlay

### 🔍 DEBUGGING STATUS:
**Extension logs show:**
```
✅ Background: "WebSocket connected to AssemblyAI v3 streaming"
✅ Background: "Offscreen capture started successfully" 
✅ Content: Test overlay message displays
❌ Missing: No audio chunks being sent to AssemblyAI
❌ Missing: No "OFFSCREEN:" messages in console logs
```

## Architecture (Chrome Extension)

### Data Flow:
1. **User Interaction**: User clicks extension popup
2. **Permission**: `popup.js` calls `chrome.tabCapture.getMediaStreamId()`
3. **Stream ID**: Popup sends stream ID to background service worker
4. **Offscreen Setup**: Background creates offscreen document
5. **Audio Capture**: Offscreen uses `getUserMedia()` with stream ID
6. **Audio Processing**: Offscreen converts to PCM16 format (16kHz, 50ms chunks)
7. **WebSocket**: Background sends audio data to AssemblyAI v3
8. **Transcription**: AssemblyAI sends back "Turn" messages with transcripts
9. **Display**: Background forwards transcripts to content script overlay

### Message Passing:
- `popup.js` → `background.js` (START_TRANSCRIPTION with streamId)
- `background.js` → `offscreen.js` (START_OFFSCREEN_CAPTURE with streamId)
- `offscreen.js` → `background.js` (AUDIO_DATA_FROM_OFFSCREEN)
- `background.js` → `content.js` (NEW_TRANSCRIPT for overlay display)

## Audio Format Requirements (AssemblyAI v3)

- **Sample Rate**: 16kHz
- **Format**: PCM16 (16-bit signed integer)
- **Channels**: Mono (single-channel)
- **Chunk Size**: 50ms (800 samples at 16kHz)
- **Encoding**: Little-endian Int16Array sent as ArrayBuffer

## API Configuration

### AssemblyAI v3 WebSocket
- **URL**: `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true&token=<API_KEY>`
- **Authentication**: Token-based (in URL parameters)
- **Message Types**: "Begin", "Turn", "End"

### Hardcoded API Keys (in background.js)
- AssemblyAI API Key: `d075180583e743dc84435b50f422373b`
- OpenAI API Key: `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`

## Next Steps for Debugging

1. **Fix Offscreen Audio Processing**: The offscreen document is not processing audio correctly
   - Check if `offscreen.js` is actually receiving messages
   - Verify `getUserMedia()` with stream ID works in offscreen context
   - Ensure audio processing pipeline (Float32 → Int16 conversion) works
   - Debug why no "OFFSCREEN:" log messages appear

2. **Verify Audio Data Flow**: Ensure audio reaches AssemblyAI
   - Check if background receives audio data from offscreen
   - Verify WebSocket.send() calls with audio ArrayBuffer
   - Monitor for AssemblyAI "Turn" response messages

3. **Test Real Audio**: Use actual speaking/audio to test transcription
   - Play YouTube video with speech
   - Speak into microphone while screen sharing
   - Verify amplitude detection and audio chunk generation

## Known Issues

- **Extension Reload Required**: Changes to background.js require extension reload (toggle off/on)
- **Offscreen Debugging**: No direct console access to offscreen document
- **Chrome Version**: Requires Chrome 116+ for offscreen document + tabCapture compatibility
- **Audio Feedback**: When tab capture works, original audio stops playing (expected behavior)