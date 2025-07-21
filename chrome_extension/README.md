# Live Transcription Assistant - Chrome Extension

Real-time transcription and AI assistant for videos and audio content in your browser.

## Features

- 🎤 **Real-time transcription** of tab audio using AssemblyAI
- 🤖 **AI assistant** powered by OpenAI GPT-4
- 📱 **Non-intrusive overlay** that doesn't block page interaction
- 🎯 **Works on any website** with audio/video content
- 🔒 **Secure** - API keys stored locally in browser

## Installation

### Option 1: Load as Unpacked Extension (Development)

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select the `chrome_extension` folder
4. The extension will appear in your browser toolbar

### Option 2: Chrome Web Store (Coming Soon)

The extension will be available on the Chrome Web Store once published.

## Setup

1. **Get API Keys:**
   - AssemblyAI: Visit [AssemblyAI Dashboard](https://www.assemblyai.com/dashboard) and get your API key
   - OpenAI: Visit [OpenAI API Keys](https://platform.openai.com/api-keys) and create an API key

2. **Configure Extension:**
   - Click the extension icon in your browser toolbar
   - Enter your AssemblyAI and OpenAI API keys
   - Click "Save API Keys"

## Usage

1. **Navigate to a webpage with audio/video** (YouTube, Twitch, Netflix, etc.)
2. **Click the extension icon** and select "Start Transcription"
3. **Captions will appear** as an overlay on the page
4. **Use the "Ask Agent" button** to ask questions about the transcript

## Supported Platforms

- ✅ YouTube
- ✅ Twitch
- ✅ Netflix
- ✅ Educational platforms
- ✅ Any website with audio/video content

## Privacy & Security

- API keys are stored locally in your browser only
- No data is sent to third parties except AssemblyAI and OpenAI
- Audio processing happens in your browser
- No tracking or analytics

## Files Structure

```
chrome_extension/
├── manifest.json          # Extension configuration
├── background.js          # Service worker for audio processing
├── content.js            # Overlay injection script
├── popup.html            # Extension popup interface
├── popup.js              # Popup functionality
├── overlay.css           # Overlay styling
├── audio-processor.js    # Audio worklet processor
└── icons/               # Extension icons
```

## Technical Details

- **Manifest Version:** 3 (latest Chrome extension standard)
- **Audio Capture:** Uses `chrome.tabCapture` API
- **Real-time Processing:** Web Audio API with AudioWorklet
- **Transcription:** AssemblyAI WebSocket streaming
- **AI Assistant:** OpenAI GPT-4 API
- **Overlay:** CSS-based non-intrusive overlay

## Development

To modify the extension:

1. Make changes to the source files
2. Go to `chrome://extensions/`
3. Click the refresh icon for the extension
4. Test your changes

## Monetization Model

- **Free Tier:** 30 minutes per month
- **Pro Tier:** $4.99/month for unlimited usage
- **Enterprise:** Custom pricing for teams

## Support

For issues or questions:
- Create an issue in the repository
- Email: support@livetranscription.com

## License

This project is licensed under the MIT License.