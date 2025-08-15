# Live Transcription Chrome Extension

A powerful Chrome extension that provides real-time transcription for browser tab audio with advanced catch-up functionality for past stream content. Features AI-powered summaries, local processing to bypass IP restrictions, and seamless integration with streaming platforms.

## 🌟 Features

### Real-Time Transcription
- **Live audio capture** from any browser tab using Chrome's `tabCapture` API
- **Real-time transcription** via AssemblyAI WebSocket streaming
- **YouTube-style captions** with bottom-center positioning
- **High-quality audio loopback** - you hear original audio without degradation
- **Smart filtering** to prevent caption flicker and optimize display
- **Professional UI** with glassmorphism design

### AI-Powered Catch-Up System
- **One-click catch-up** for the last 30-60 minutes of stream content
- **Multi-platform support**: Twitch, YouTube, Kick and other streaming platforms
- **Local audio processing** using yt-dlp to bypass IP restrictions
- **AI summarization** with OpenAI GPT-4 for key moments and insights
- **Deep linking** to specific timestamps in VODs
- **Progress tracking** with real-time status updates

### Ask Agent Feature
- **GPT-4 integration** for Q&A about transcription content
- **Context-aware responses** based on live transcript data
- **Interactive UI** with top-right overlay controls

## 🏗️ Architecture Overview

### Core Components

**Chrome Extension (Manifest V3)**
- `manifest.json` - Extension configuration with required permissions
- `background.js` - Service worker managing WebSocket connections and native messaging
- `content.js` - Content script with dual overlay system (captions + controls)
- `offscreen.js` - Offscreen document for tab audio capture and processing
- `audio-processor.js` - AudioWorklet for high-performance audio processing
- `popup.js/html` - Extension popup interface

**Native Messaging System**
- `native_messaging/live_transcription_host.py` - Python host for local processing
- `native_messaging/host_wrapper.sh` - Bash wrapper ensuring proper execution
- Chrome native messaging manifest for secure communication

### Data Flow

#### Real-Time Transcription Flow
```
User clicks popup → chrome.tabCapture.getMediaStreamId() 
                 ↓
Background script → Creates offscreen document with streamId
                 ↓
Offscreen document → getUserMedia() + AudioWorklet processing
                  ↓
AudioWorklet → Dual-path: Native rate for playback + 16kHz for transcription
             ↓
Background WebSocket → AssemblyAI v3 streaming API
                     ↓
Content script overlay → YouTube-style caption display
```

#### Catch-Up Processing Flow
```
User clicks catch-up → AWS Lambda detects stream and gets VOD URL
                    ↓
Native messaging host → Downloads MP3 using yt-dlp (local processing)
                     ↓
AssemblyAI HTTP API → Transcribes downloaded audio file
                   ↓
OpenAI GPT-4 → Generates AI summary with key moments
            ↓
Content script → Displays results in professional modal UI
```

## 📁 File Structure

### Essential Chrome Extension Files
```
chrome_extension/
├── manifest.json              # Extension configuration (Manifest V3)
├── background.js              # Service worker (WebSocket + native messaging)
├── content.js                 # Content script (UI overlays + catch-up modal)
├── popup.js/html              # Extension popup interface
├── offscreen.js/html          # Tab audio capture and processing
├── audio-processor.js         # AudioWorklet for audio processing
├── content-audio.js           # Content script audio handling (legacy support)
├── overlay.css               # Styling for overlays and modals
└── transcript-storage.js     # Local transcript storage utilities
```

### Native Messaging Components
```
native_messaging/
├── live_transcription_host.py # Main Python processing host
├── host_wrapper.sh           # Bash wrapper for execution
└── Chrome manifest (installed separately in Chrome's native messaging directory)
```

### Supporting Infrastructure
```
aws_lambda/                   # Optional AWS Lambda deployment
serverless/                  # Optional Vercel serverless functions  
backend/                     # Legacy backend (unused in production)
```

## 🛠️ Technical Specifications

### Audio Processing Pipeline
- **Input Format**: Native browser sample rate (44.1kHz/48kHz) from tab capture
- **Playback Path**: Original quality audio → speakers (no quality loss)
- **Transcription Path**: Resampled to 16kHz PCM16 → AssemblyAI
- **Chunk Size**: 800 samples at 16kHz (50ms chunks for real-time processing)
- **Format**: Little-endian Int16Array sent as ArrayBuffer

### API Integrations

#### AssemblyAI
- **Real-time**: WebSocket streaming API v3
- **Catch-up**: HTTP API v2 for file uploads
- **Format**: PCM16, 16kHz sample rate
- **Authentication**: API key in URL parameters (WebSocket) / Authorization header (HTTP)

#### OpenAI GPT-4
- **Purpose**: AI summarization of transcripts
- **Model**: GPT-4 for high-quality summaries
- **Input**: Full transcript text + context
- **Output**: Structured summary with key moments and insights

#### Platform APIs
- **Twitch**: Helix API for VOD detection and metadata
- **YouTube/Kick**: Direct stream processing via yt-dlp
- **Authentication**: Client credentials for Twitch API

### Performance Optimizations
- **Dual Audio Context**: Native sample rate for playback quality
- **Linear Interpolation Resampling**: High-quality downsampling for transcription
- **Smart Update Logic**: Reduces unnecessary DOM updates
- **Memory Management**: Proper cleanup of audio contexts and streams
- **Efficient File Processing**: MP3-only downloads (~25MB vs ~250MB video)

## 🚀 Installation & Setup

### Prerequisites
- **Chrome 116+** (required for Manifest V3 + offscreen documents)
- **Python 3.9+** with pip (for native messaging)
- **yt-dlp** Python package
- **macOS/Linux** (Windows support possible with modifications)

### Chrome Extension Installation
1. **Enable Developer Mode** in `chrome://extensions/`
2. **Load Extension**: Click "Load unpacked" and select `chrome_extension/` folder
3. **Note Extension ID**: Copy the extension ID for native messaging setup

### Native Messaging Setup

#### Option 1: Automatic Setup (Recommended)
1. **Install Python Dependencies**:
   ```bash
   pip3 install yt-dlp requests openai
   ```

2. **Load the Chrome Extension** in Developer Mode first (see Chrome Extension Installation above)

3. **Run Automatic Setup**:
   ```bash
   python3 setup_native_messaging.py
   ```
   
   This script will:
   - Automatically detect your Chrome extension ID
   - Create the native messaging manifest with the correct ID
   - Set proper file permissions
   - Provide setup verification

#### Option 2: Manual Setup
If the automatic setup doesn't work, you can set up manually:

1. **Install Python Dependencies**:
   ```bash
   pip3 install yt-dlp requests openai
   ```

2. **Get Your Extension ID**:
   ```bash
   python3 get_extension_id.py
   ```
   Or manually: Go to `chrome://extensions/` and copy your extension ID

3. **Create Native Messaging Manifest**:
   ```bash
   # Create directory (macOS)
   mkdir -p "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts"
   
   # For Windows: %USERPROFILE%\AppData\Local\Google\Chrome\User Data\NativeMessagingHosts
   # For Linux: ~/.config/google-chrome/NativeMessagingHosts
   ```

4. **Create Manifest File**: Edit `native_messaging/live_transcription_host.json` and replace `YOUR_EXTENSION_ID_HERE` with your actual extension ID

5. **Make Scripts Executable**:
   ```bash
   chmod +x native_messaging/host_wrapper.sh
   chmod +x native_messaging/live_transcription_host.py
   ```

6. **Copy Manifest**: Copy the updated manifest to Chrome's native messaging directory

#### Verification
After setup, restart Chrome and test the catch-up feature. The extension popup will show setup status and provide troubleshooting guidance.

### API Keys Configuration
Update the following files with your API keys:
- `chrome_extension/background.js` (lines 19-20)
- `native_messaging/live_transcription_host.py` (lines 18-19)

**Required API Keys**:
- **AssemblyAI API Key**: Get from [AssemblyAI Console](https://www.assemblyai.com/dashboard)
- **OpenAI API Key**: Get from [OpenAI Platform](https://platform.openai.com/api-keys)

## 📖 Usage Guide

### Real-Time Transcription
1. **Navigate** to any webpage with audio content (YouTube, Netflix, streaming sites)
2. **Click extension icon** and select "Start Transcription"  
3. **Grant permission** when Chrome requests tab audio access
4. **View live captions** at the bottom center of your screen
5. **Use "Ask Agent"** button for GPT-4 Q&A about the transcript
6. **Click "Stop"** to end transcription

### Catch-Up Feature
1. **Start real-time transcription** first (required for catch-up button to appear)
2. **Navigate** to a supported streaming platform (Twitch, YouTube, Kick)
3. **Click "⚡ Catch Up"** button in top-right controls
4. **Select duration** (30 or 60 minutes)
5. **Wait for processing** - progress bar shows real-time status
6. **Review results** - AI summary, transcript excerpt, and processing details
7. **Click deep links** to jump to specific moments in the original VOD

### Supported Platforms
- **Twitch**: Full support with VOD deep linking
- **YouTube**: Live stream processing and VOD support
- **Kick**: Basic live stream support
- **Other platforms**: Works with any site that has audio content

## 🔧 Development & Debugging

### Debug Logs
- **Chrome Extension**: Service worker console (`chrome://extensions` → Details → Service Worker)
- **Content Script**: Webpage console (F12 Developer Tools)
- **Native Messaging**: Check `/tmp/native_messaging_debug.log` on macOS/Linux

### Common Issues & Solutions

**Extension Won't Load**:
- Verify Chrome 116+ and Developer Mode enabled
- Check manifest.json syntax
- Ensure all required files are present

**Audio Not Captured**:
- Verify webpage has active audio
- Check Chrome permissions for the extension
- Try reloading the extension

**Native Messaging Fails**:
- Verify manifest file exists at correct path
- Check script permissions (`chmod +x`)
- Ensure Python dependencies installed
- Restart Chrome after manifest changes

**Catch-Up Not Working**:
- Ensure real-time transcription is active first
- Verify supported streaming platform
- Check API keys are configured correctly
- Monitor debug logs for specific errors

### Performance Monitoring
- **Memory Usage**: Monitor in Chrome Task Manager
- **CPU Usage**: Audio processing should be minimal
- **Network**: WebSocket connection for real-time, HTTP uploads for catch-up
- **Storage**: Temporary files cleaned automatically

## 🏗️ Architecture Decisions

### Why Offscreen Documents?
Content scripts cannot access `chrome.tabCapture` due to security restrictions. Offscreen documents provide the necessary context while maintaining security boundaries.

### Why AudioWorklet?
Modern, high-performance audio processing with dedicated worker threads. Superior to deprecated ScriptProcessorNode.

### Why Native Messaging?
Enables local processing to bypass IP restrictions and rate limits while maintaining security through Chrome's native messaging protocol.

### Why Dual Audio Paths?
Maintains original audio quality for user experience while providing optimal format for transcription services.

## 📊 Cost Analysis (API Usage)

### Per Catch-Up Request (30 minutes)
- **AssemblyAI**: ~$0.35 (file transcription)
- **OpenAI GPT-4**: ~$0.15-0.25 (summary generation)  
- **Total**: ~$0.55 per catch-up

### Per Real-Time Hour
- **AssemblyAI**: ~$0.65 (streaming transcription)
- **OpenAI GPT-4**: Variable based on "Ask Agent" usage

## 🛡️ Security & Privacy

### Data Handling
- **Audio**: Processed locally and via secure APIs, not stored permanently
- **Transcripts**: Stored locally in browser, can be cleared by user
- **API Communications**: HTTPS only, authenticated requests
- **Chrome APIs**: Uses standard Chrome extension APIs with declared permissions

### Permissions
- `tabCapture`: Required for browser tab audio capture
- `offscreen`: Required for audio processing context
- `scripting`: Required for content script injection
- `storage`: Required for local transcript storage
- `nativeMessaging`: Required for local processing capabilities

## 🚀 Deployment Options

### Chrome Extension Only (Serverless)
- Uses existing serverless backends for catch-up processing
- No local setup required beyond API keys
- Subject to IP restrictions on some platforms

### Full Local Setup (Recommended)
- Native messaging for local processing  
- Bypasses IP restrictions completely
- Requires Python environment setup
- Best performance and reliability

### AWS Lambda Deployment
- Optional serverless backend deployment
- See `aws_lambda/DEPLOYMENT_GUIDE.md` for instructions
- Alternative to Vercel serverless functions

## 📚 Code Documentation

### Key Classes and Functions

#### `TranscriptionService` (background.js)
- **Purpose**: Main service worker managing all transcription operations
- **Key Methods**: 
  - `startTranscription()`: Initiates real-time transcription
  - `requestCatchup()`: Handles catch-up processing with fallback chain
  - `handleWebSocketMessage()`: Processes real-time transcription results

#### `OverlaySystem` (content.js)
- **Purpose**: Manages UI overlays and user interactions
- **Key Methods**:
  - `updateCaption()`: Updates live caption display
  - `showCatchupModal()`: Displays catch-up results
  - `initializeControls()`: Sets up overlay controls

#### `AudioCapture` (offscreen.js)
- **Purpose**: Handles tab audio capture and processing
- **Key Methods**:
  - `startCapture()`: Initiates audio capture with getUserMedia
  - `setupAudioWorklet()`: Configures audio processing pipeline
  - `handleAudioData()`: Processes audio chunks for transmission

### API Integration Patterns

#### WebSocket Management
```javascript
// Real-time transcription WebSocket
const wsUrl = `wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true&token=${apiKey}`;
this.websocket = new WebSocket(wsUrl);
```

#### Native Messaging Protocol
```javascript
// Send message to native host
chrome.runtime.connectNative('live_transcription_host').postMessage({
  type: 'catchup',
  data: { vod_url, stream_url, duration_minutes }
});
```

#### Audio Processing Chain
```javascript
// AudioWorklet processing
const audioWorklet = new AudioWorkletNode(audioContext, 'audio-processor');
audioWorklet.port.onmessage = (event) => {
  const { data, amplitude } = event.data;
  // Send to background for WebSocket transmission
};
```

## 📈 Future Enhancements

### Planned Features
- **Multi-language support**: AssemblyAI supports 50+ languages
- **Custom vocabulary**: Domain-specific transcription improvements
- **Export functionality**: Save transcripts and summaries
- **Keyboard shortcuts**: Hotkey controls for power users
- **Background processing**: Continue when tab not active
- **Batch processing**: Process multiple time periods
- **Integration APIs**: Export to note-taking applications

### Technical Improvements
- **WebRTC optimization**: Enhanced audio capture methods
- **Caching system**: Store VOD metadata locally
- **Rate limiting**: Smart API usage management
- **Error recovery**: Improved fault tolerance
- **Performance metrics**: Built-in performance monitoring

## 🤝 Contributing

### Development Setup
1. **Clone repository**: `git clone <repository-url>`
2. **Install dependencies**: Follow installation guide above
3. **Load extension**: Use Developer Mode in Chrome
4. **Make changes**: Edit source files
5. **Test thoroughly**: Verify functionality across platforms
6. **Submit PR**: Include detailed description and test results

### Code Style
- **JavaScript**: Use modern ES6+ features
- **Python**: Follow PEP 8 guidelines  
- **Documentation**: Update README for significant changes
- **Testing**: Verify across different streaming platforms

## 📄 License

This project is licensed under the MIT License. See LICENSE file for details.

## 🆘 Support

For issues, bug reports, or feature requests:
1. **Check debug logs** first (see Debugging section)
2. **Review common issues** in troubleshooting guide
3. **Create detailed issue report** with:
   - Chrome version and OS
   - Extension version
   - Steps to reproduce
   - Debug log output
   - Expected vs actual behavior

## 🎯 Acknowledgments

- **AssemblyAI**: Real-time transcription API
- **OpenAI**: GPT-4 AI summarization  
- **yt-dlp**: Video/audio download capabilities
- **Chrome Extensions Team**: Manifest V3 and native messaging APIs
- **Web Audio API**: High-performance audio processing