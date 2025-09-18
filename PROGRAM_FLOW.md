# Live Transcription Assistant - Complete Program Flow

## 🏗️ **Architecture Overview**

This Chrome extension provides real-time transcription with a secure backend architecture:

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│  Chrome Tab     │    │  Chrome Extension│    │  AWS Backend    │
│  (Audio Source) │───→│  (Processing)    │───→│  (API Proxy)    │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                              │                         │
                              ▼                         ▼
                    ┌──────────────────┐    ┌─────────────────┐
                    │  Content Scripts │    │  AssemblyAI     │
                    │  (UI Overlay)    │    │  OpenAI APIs    │
                    └──────────────────┘    └─────────────────┘
```

## 📁 **File Structure & Responsibilities**

### **Core Extension Files**
- **`manifest.json`** - Extension configuration and permissions
- **`background.js`** - Main service worker (TranscriptionService class)
- **`popup.js`** - Extension popup UI controller (PopupController class)
- **`popup.html`** - Extension popup interface
- **`content.js`** - Page overlay manager
- **`content-audio.js`** - Audio capture handler
- **`offscreen.js`** - Audio processing document
- **`audio-processor.js`** - AudioWorklet for real-time processing

### **Catch-up Feature Files**
- **`twitch-api.js`** - Twitch API integration (TwitchAPI class)
- **`m3u8-downloader.js`** - Stream video downloader (M3U8Downloader class)
- **`audio-uploader.js`** - Large file uploader (ChunkedAudioUploader class)

### **UI & Styling**
- **`overlay.css`** - Transcription overlay styling

---

## 🚀 **Main Program Flows**

### **1. LIVE TRANSCRIPTION FLOW**

#### **Step 1: User Authentication**
```
popup.js:login() → AWS Backend → popup.js:loadCreditsBalance()
```
- User enters credentials in popup
- JWT token stored locally for API access
- Credit balance displayed

#### **Step 2: Transcription Initialization**
```
popup.js:startTranscription() → background.js:startTranscription()
```
- Check user authentication and credits
- Get current tab for audio capture
- Inject content scripts if needed

#### **Step 3: Tab Audio Capture**
```
background.js:startTranscription() → chrome.tabCapture.getMediaStreamId()
                                 → background.js:setupOffscreenDocument()
                                 → offscreen.js
```
- Request tab capture permission from Chrome
- Create offscreen document for audio processing
- Get media stream from tab

#### **Step 4: Audio Processing Pipeline**
```
offscreen.js:setupAudioCapture() → audio-processor.js:AudioWorklet
                                → background.js:handleOffscreenMessage()
                                → AssemblyAI WebSocket
```
- Capture audio at native sample rate
- Resample to 16kHz PCM16 for AssemblyAI
- Send chunks via WebSocket to AssemblyAI

#### **Step 5: Real-time Transcription**
```
AssemblyAI → background.js:handleTranscriptionResult() → content.js:displayTranscript()
```
- Receive transcription results from AssemblyAI
- Filter low-confidence results
- Display captions in bottom-center overlay

#### **Step 6: Stop & Cleanup**
```
popup.js:stopTranscription() → background.js:stopTranscription() → cleanup()
```
- Stop WebSocket connection
- Close offscreen document
- Reset all audio contexts and streams

---

### **2. CATCH-UP SUMMARY FLOW**

#### **Step 1: Stream URL Processing**
```
popup.js:startCatchup() → background.js:processCatchup() → twitch-api.js:getCatchupM3U8()
```
- Extract channel name from Twitch URL
- Get channel ID via Twitch Helix API
- Find recent VODs or live stream

#### **Step 2: GQL Authentication**
```
twitch-api.js:getGQLToken() → Twitch GraphQL API
```
- Get playback access token for VOD access
- Required for m3u8 playlist access

#### **Step 3: Video Download**
```
m3u8-downloader.js:downloadStream() → Browser-side segment download
```
- Parse m3u8 master playlist
- Select lowest quality stream for efficiency
- Download video segments concurrently

#### **Step 4: Audio Extraction**
```
background.js:extractAudioFromSegments() → Web Audio API
```
- Decode video to extract audio track
- Resample to 16kHz mono PCM
- Convert to AssemblyAI format

#### **Step 5: Large File Upload**
```
audio-uploader.js:uploadAudioForTranscription() → AWS Backend
```
- Try presigned S3 upload for large files
- Fall back to chunked upload if needed
- Handle 4MB API Gateway limits

#### **Step 6: AI Processing**
```
AWS Backend → AssemblyAI → OpenAI GPT-4 → Summary Response
```
- Backend transcribes audio via AssemblyAI
- Generate summary via OpenAI
- Return formatted summary to extension

---

### **3. ASK AGENT FLOW**

#### **Simple Q&A Pipeline**
```
content.js:Ask Agent Button → background.js:askAgent() → AWS Backend → OpenAI GPT-4
```
- User clicks Ask Agent button in overlay
- Send question + current transcript to backend
- OpenAI processes question about transcript
- Display answer in overlay

---

### **4. CREDIT MANAGEMENT FLOW**

#### **Credit Purchase**
```
popup.js:showCreditPackages() → popup.js:buyCredits() → AWS Backend → Stripe Checkout
```
- Show package selection UI
- Create Stripe checkout session
- Open checkout in new tab

#### **Payment Processing**
```
Stripe → AWS Webhook → credits.py:handle_successful_payment() → DynamoDB
```
- Stripe sends payment confirmation
- Webhook adds credits to user account
- User sees updated balance

#### **Credit Deduction**
```
Real-time: AWS Backend tracks session minutes
Ask Agent: 5 credits per question deducted immediately
```

#### **Auto-stop on Depletion**
```
popup.js:loadCreditsBalance() → Detects 0 credits → Auto-stops transcription
```
- Credit balance checked every 30 seconds during transcription
- Automatically stops if credits depleted

---

## 🔄 **Message Passing System**

### **Inter-Component Communication**

#### **Popup ↔ Background**
```javascript
chrome.runtime.sendMessage({
  type: 'START_TRANSCRIPTION',
  streamId: streamId,
  tabId: tabId,
  userToken: token
})
```

#### **Background ↔ Content Script**
```javascript
chrome.tabs.sendMessage(tabId, {
  type: 'NEW_TRANSCRIPT',
  text: transcriptText,
  isFinal: true
})
```

#### **Background ↔ Offscreen**
```javascript
chrome.runtime.sendMessage({
  type: 'START_OFFSCREEN_CAPTURE',
  streamId: streamId
})
```

#### **Offscreen → Background**
```javascript
chrome.runtime.sendMessage({
  type: 'AUDIO_DATA_FROM_OFFSCREEN',
  audioData: pcmData
})
```

---

## 🛡️ **Security & Authentication**

### **JWT Token Flow**
1. User logs in via popup
2. Backend validates credentials
3. JWT token stored in `chrome.storage.local`
4. Token included in all API requests
5. Backend validates JWT for each request

### **API Key Security**
- No hardcoded API keys in extension
- Keys stored securely in AWS Lambda environment
- Backend acts as proxy to external APIs
- Extension never directly accesses AssemblyAI/OpenAI

### **CORS & Permissions**
- Backend configured for Chrome extension origins
- Minimal Chrome permissions requested
- Host permissions limited to required domains

---

## 📊 **Error Handling & Edge Cases**

### **Credit Depletion**
- Real-time monitoring during transcription
- Automatic transcription stop when credits = 0
- Clear user notification and purchase prompts

### **API Failures**
- WebSocket reconnection for AssemblyAI
- Retry logic for backend API calls
- Graceful degradation when services unavailable

### **Audio Issues**
- Permission denied handling
- No audio detection and user warnings
- Audio context suspension recovery

### **Content Script Injection**
- Auto-injection when content scripts unavailable
- Multiple tab support with state isolation
- Clean resource management on tab close

---

## 🎯 **Performance Optimizations**

### **Audio Processing**
- Dual audio path: native quality playback + 16kHz transcription
- AudioWorklet for modern, efficient processing
- Smart buffering and chunk management

### **UI Responsiveness**
- Smart transcript filtering (>3 chars, >0.1 confidence)
- Throttled UI updates (50ms delays)
- Minimal DOM manipulation

### **Network Efficiency**
- Chunked uploads for large files
- Concurrent segment downloads (6 max)
- Lowest quality stream selection for catch-up

### **Memory Management**
- Complete resource cleanup on stop
- Audio context disposal
- WebSocket connection management

---

## 🧪 **Testing & Debugging**

### **Debug Features** (Removed for Production)
- Comprehensive console logging with emojis
- Progress tracking for catch-up downloads
- Error state visualization
- Performance timing metrics

### **Chrome DevTools Integration**
- Service worker debugging
- Content script console access
- Network request monitoring
- Extension popup inspection

---

This documentation provides a complete understanding of how the Live Transcription Assistant operates, from user interaction to backend processing, ensuring maintainable and scalable code architecture.