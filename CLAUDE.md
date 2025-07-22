# CLAUDE.md

This file provides complete guidance to Claude Code when working with this Chrome Extension project.

## Project Overview

This is a **fully functional Chrome Extension** for live transcription that captures browser tab audio and provides real-time transcription with a professional overlay system. The system consists of:

1. **Chrome Tab Capture** using Manifest V3 with `chrome.tabCapture.getMediaStreamId()`
2. **Hybrid Audio Processing** with offscreen document + AudioWorklet for optimal performance
3. **Real-time transcription** via AssemblyAI v3 WebSocket streaming
4. **Dual overlay system** with bottom-center captions and top-right controls
5. **AI assistant integration** with OpenAI GPT-4 for transcript-based Q&A

## Current Status (FULLY WORKING as of 2025-07-22)

### ✅ COMPLETED AND WORKING:
1. **Tab Audio Capture**: ✅ Successfully captures audio from any browser tab
2. **Real-time Transcription**: ✅ Live captions appear smoothly as users speak  
3. **Audio Quality**: ✅ High-quality audio loopback (users hear original audio)
4. **YouTube-style UI**: ✅ Captions at bottom center, controls at top right
5. **Performance Optimized**: ✅ Minimal lag, smart update filtering
6. **Complete Shutdown**: ✅ All resources properly cleaned up when stopped
7. **AssemblyAI Integration**: ✅ Real-time streaming with proper PCM16 format
8. **Ask Agent Feature**: ✅ GPT-4 Q&A about transcription content

## Architecture Overview

### Final Implementation: Hybrid Offscreen + AudioWorklet
After testing multiple approaches, the final architecture uses:
- **Offscreen Document**: Handles tab capture (required for Chrome security)
- **AudioWorklet**: Modern audio processing with better performance
- **Dual Audio Path**: High-quality playback + optimized transcription processing

### Current Data Flow:
1. **User clicks popup** → `chrome.tabCapture.getMediaStreamId()` 
2. **Popup → Background** → Sends streamId + creates offscreen document
3. **Offscreen Document** → Uses `getUserMedia()` with streamId (only context with proper permissions)
4. **AudioWorklet Processing** → Converts audio: native sample rate for playback, 16kHz for AssemblyAI
5. **Background WebSocket** → Forwards processed audio to AssemblyAI v3
6. **Real-time Display** → Optimized caption updates with smart filtering

## Key Files and Their Roles

### Core Extension Files
- **`manifest.json`** - Manifest V3 with tabCapture, offscreen, and scripting permissions
- **`background.js`** - Service worker managing AssemblyAI WebSocket, smart transcript filtering
- **`popup.js`** - Extension UI with tab capture permission flow
- **`popup.html`** - Clean extension popup interface
- **`content.js`** - Dual overlay system (captions + controls), YouTube-style positioning  
- **`content-audio.js`** - Handles content script audio messages (minimal, for compatibility)
- **`offscreen.js`** - Tab capture + AudioWorklet processing with high-quality audio loopback
- **`offscreen.html`** - Offscreen document for audio processing
- **`audio-processor.js`** - Modern AudioWorklet with dual-path processing and resampling
- **`overlay.css`** - Styling for transcription overlays

### Deprecated/Legacy Files
- **`overlay_with_agent.py`** - Old Python implementation (not used)
- **`agent_utils.py`** - Old Python utilities (functionality moved to JS)

## Technical Specifications

### Audio Processing Pipeline
- **Input**: Native browser sample rate (44.1kHz/48kHz) from tab capture
- **Playback Path**: Original quality audio → speakers (no degradation)
- **Transcription Path**: Resampled to 16kHz PCM16 → AssemblyAI
- **Chunk Size**: 800 samples at 16kHz (50ms chunks)
- **Format**: Little-endian Int16Array sent as ArrayBuffer

### AssemblyAI v3 Integration
- **WebSocket URL**: `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true&token=<API_KEY>`
- **Authentication**: Token in URL parameters
- **Message Format**: 
  - Receives: `{"type":"Turn","transcript":"text","end_of_turn":false,"turn_order":0}`
  - Sends: Binary PCM16 audio data as ArrayBuffer
- **Real-time Processing**: Smart filtering prevents flicker, 50ms update delays

### UI/UX Design
- **Captions**: Bottom center, YouTube-style positioning (80px from bottom)
- **Controls**: Top right corner (Ask Agent + Stop buttons)
- **Styling**: Modern glassmorphism with backdrop blur
- **Colors**: Yellow for partial transcripts, green for final
- **Responsiveness**: Auto-width captions, mobile-friendly
- **Accessibility**: High contrast, readable fonts

## Current Implementation Details

### Message Passing System
```
popup.js → background.js: START_TRANSCRIPTION + streamId + tabId
background.js → offscreen.js: START_OFFSCREEN_CAPTURE + streamId  
offscreen.js → background.js: AUDIO_DATA_FROM_OFFSCREEN + audio data
background.js → content.js: NEW_TRANSCRIPT + text + isFinal
background.js → AssemblyAI: Binary audio chunks via WebSocket
```

### Smart Transcript Processing (background.js)
- **Filtering**: Only shows transcripts >3 characters or with >0.1 confidence
- **Throttling**: 50ms delays for partial updates, immediate for final
- **Turn Management**: Prevents old transcript updates from showing
- **Significant Change Detection**: Only updates with 2+ new characters or new words

### Performance Optimizations
- **Dual Audio Context**: Native sample rate for playback quality
- **Linear Interpolation Resampling**: Better quality than simple downsampling
- **Smart Update Logic**: Reduces unnecessary DOM updates
- **Complete Resource Cleanup**: All audio contexts, streams, and timers properly disposed
- **Memory Management**: Clears buffers and references on stop

### Error Handling & Robustness
- **Graceful WebSocket Handling**: Proper closure codes, reconnection ready
- **Audio Context Management**: Handles suspended states, sample rate mismatches
- **Content Script Injection**: Auto-injects if not available, handles multiple tabs
- **Offscreen Communication**: Handles document lifecycle, message failures
- **User Feedback**: Clear status messages, loading states, error descriptions

## API Keys (Hardcoded in background.js)
- **AssemblyAI**: `d075180583e743dc84435b50f422373b`
- **OpenAI GPT-4**: `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`

## Installation & Usage

### Prerequisites
- **Chrome 116+** (required for offscreen document + tabCapture compatibility)
- **Developer mode** enabled in chrome://extensions

### How to Use
1. **Load Extension**: Add to Chrome via developer mode
2. **Navigate to Content**: Go to any webpage with audio (YouTube, Netflix, etc.)
3. **Start Transcription**: Click extension icon → "Start Transcription"
4. **Permission Flow**: Chrome requests tab capture permission (auto-granted)
5. **Live Captions**: See real-time captions at bottom of screen
6. **Ask Agent**: Use top-right button for GPT-4 Q&A about transcript
7. **Stop**: Click stop button in top-right controls

### Expected Behavior
- **Audio**: Brief pause then restored with high quality
- **Captions**: Smooth, YouTube-style updates at screen bottom
- **Performance**: Minimal CPU usage, no lag or stuttering
- **Compatibility**: Works on all websites with audio content

## Development Notes

### Testing Workflow
1. **Make changes** to any extension file
2. **Reload extension** in chrome://extensions (toggle off/on)
3. **Test on YouTube** or other audio content
4. **Check console logs** in extension service worker for debugging
5. **Content script logs** visible in webpage console

### Known Behaviors (Not Issues)
- **Audio stops briefly** when starting (Chrome security requirement)
- **Extension reload needed** for background.js changes
- **High CPU during transcription** (expected for real-time processing)
- **WebSocket errors on stop** (expected during cleanup)

### Architecture Decisions Made
- **Offscreen over Content Scripts**: Content scripts can't use tabCapture
- **AudioWorklet over ScriptProcessor**: Modern, better performance
- **Dual Audio Path**: Quality + transcription requirements
- **Smart Filtering**: User experience over raw data display
- **Bottom Captions**: Familiar YouTube-style positioning
- **Resource Cleanup**: Prevents memory leaks and CPU waste

## Future Enhancement Ideas
- **Multiple Language Support**: AssemblyAI supports many languages
- **Caption Styling Options**: User customization of appearance
- **Transcript Export**: Save transcriptions to file
- **Hotkey Controls**: Keyboard shortcuts for start/stop
- **Background Transcription**: Continue when tab not active
- **Meeting Mode**: Optimized for video calls and meetings

## Troubleshooting Common Issues

### If No Captions Appear
1. Check service worker console for WebSocket errors
2. Verify AssemblyAI API key is valid
3. Ensure audio is playing in the tab
4. Try reloading the extension

### If Audio Quality is Poor
1. Check that both audio contexts are using native sample rate
2. Verify loopback connection in offscreen document
3. Ensure linear interpolation resampling is working

### If Extension Won't Start
1. Verify Chrome 116+ 
2. Check that tabCapture permission is granted
3. Ensure webpage has audio content
4. Try on different website (YouTube recommended)

### Performance Issues
1. Check that cleanup runs completely on stop
2. Verify no WebSocket connections remain open
3. Ensure AudioWorklet buffers are cleared
4. Monitor service worker memory usage

This extension is a complete, production-ready solution for real-time browser tab transcription with professional-grade audio processing and user experience.