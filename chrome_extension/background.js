// Background service worker for Live Transcription Assistant
class TranscriptionService {
  constructor() {
    this.websocket = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.isTranscribing = false;
    this.assemblyAiApiKey = null;
    this.openAiApiKey = null;
    this.transcript = '';
    this.keysLoaded = false;
    this.currentTranscriptionTabId = null;
    this.capturedStream = null;
    this.audioProcessor = null;
    
    // Load API keys from storage
    this.loadApiKeys().then(() => {
      this.keysLoaded = true;
      console.log('INIT: Background service ready with API keys');
    });
  }
  
  async loadApiKeys() {
    try {
      const result = await chrome.storage.local.get(['assemblyAiKey', 'openAiKey']);
      this.assemblyAiApiKey = result.assemblyAiKey;
      this.openAiApiKey = result.openAiKey;
      
      // Always use hardcoded keys from config (bypass storage issues)
      console.log('INIT: Using hardcoded API keys from config...');
      this.assemblyAiApiKey = "d075180583e743dc84435b50f422373b";
      this.openAiApiKey = "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";
      
      console.log('INIT: API keys loaded - AssemblyAI:', this.assemblyAiApiKey.substring(0, 8) + '...');
    } catch (error) {
      console.error('Failed to load API keys:', error);
    }
  }
  
  async saveApiKeys(assemblyAiKey, openAiKey) {
    try {
      await chrome.storage.local.set({
        assemblyAiKey: assemblyAiKey,
        openAiKey: openAiKey
      });
      this.assemblyAiApiKey = assemblyAiKey;
      this.openAiApiKey = openAiKey;
    } catch (error) {
      console.error('Failed to save API keys:', error);
    }
  }
  
  async ensureContentScriptsInjected(tabId) {
    try {
      // Test if content scripts are already available
      const testResponse = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'PING'
        }, (response) => {
          if (chrome.runtime.lastError) {
            resolve(null);
          } else {
            resolve(response);
          }
        });
      });
      
      if (testResponse) {
        console.log('BG_INJECT: Content scripts already available');
        return;
      }
      
      console.log('BG_INJECT: Content scripts not available, injecting...');
      
      // Inject content scripts manually
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content.js']
      });
      
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['content-audio.js']
      });
      
      await chrome.scripting.insertCSS({
        target: { tabId: tabId },
        files: ['overlay.css']
      });
      
      console.log('BG_INJECT: Content scripts injected successfully');
      
      // Wait a moment for scripts to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error('BG_INJECT: Failed to inject content scripts:', error);
      throw new Error('Failed to inject content scripts: ' + error.message);
    }
  }
  
  async startTranscription(tabId, streamId) {
    if (this.isTranscribing) {
      console.log('BG: Transcription already running');
      return;
    }
    
    console.log('BG: Starting transcription for tab:', tabId, 'with stream ID:', streamId);
    
    // Wait for API keys to be loaded
    if (!this.keysLoaded) {
      console.log('BG: Waiting for API keys to load...');
      await this.loadApiKeys();
      this.keysLoaded = true;
    }
    
    if (!this.assemblyAiApiKey) {
      throw new Error('AssemblyAI API key not configured');
    }
    
    try {
      // Set the current tab as transcription target
      this.currentTranscriptionTabId = tabId;
      console.log('BG: Set transcription target tab to:', tabId);
      
      // Step 1: Ensure content scripts are injected
      console.log('BG_STEP_1: Injecting content scripts...');
      await this.ensureContentScriptsInjected(tabId);
      
      // Step 2: Connect to AssemblyAI WebSocket
      console.log('BG_STEP_2: Connecting to AssemblyAI...');
      await this.connectToAssemblyAI();
      
      // Step 3: Set up offscreen document for audio processing (content scripts can't use tabCapture)
      console.log('BG_STEP_3: Setting up offscreen document with AudioWorklet...');
      await this.setupOffscreenDocument();
      
      // Step 4: Start audio capture in offscreen document with stream ID
      console.log('BG_STEP_4: Starting offscreen audio capture with AudioWorklet...');
      
      const captureResponse = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'START_OFFSCREEN_CAPTURE',
          streamId: streamId
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('BG: Error communicating with offscreen document:', chrome.runtime.lastError);
            reject(new Error('Failed to communicate with offscreen document: ' + chrome.runtime.lastError.message));
            return;
          }
          console.log('BG: Received response from offscreen document:', response);
          resolve(response);
        });
      });
      
      if (!captureResponse.success) {
        throw new Error('Offscreen capture failed: ' + (captureResponse.error || 'Unknown error'));
      }
      
      console.log('BG: Offscreen capture started successfully');
      
      this.isTranscribing = true;
      console.log('✅ BG: Transcription started successfully');
      
      // Notify content script that transcription has started
      chrome.tabs.sendMessage(tabId, {
        type: 'TRANSCRIPTION_STARTED'
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('BG: Could not notify content script of transcription start:', chrome.runtime.lastError.message);
        } else {
          console.log('BG: Content script notified of transcription start');
        }
      });
      
    } catch (error) {
      console.error('BG: Failed to start transcription:', error);
      // Clean up on error
      this.stopTranscription();
      throw error;
    }
  }
  
  async connectToAssemblyAI() {
    console.log('WEBSOCKET_STEP_1: Connecting to AssemblyAI...');
    
    if (!this.assemblyAiApiKey) {
      throw new Error('ERROR_NO_ASSEMBLYAI_KEY: AssemblyAI API key not found');
    }
    
    // Use AssemblyAI v3 streaming API endpoint
    const params = new URLSearchParams({
      sample_rate: 16000,
      format_turns: true,
      token: this.assemblyAiApiKey
    });
    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
    
    console.log('WEBSOCKET_STEP_2: Connecting to v3 endpoint:', wsUrl);
    
    return new Promise((resolve, reject) => {
      try {
        this.websocket = new WebSocket(wsUrl);
      } catch (error) {
        console.error('WEBSOCKET_ERROR: Failed to create WebSocket:', error);
        reject(error);
        return;
      }
      
      this.websocket.onopen = () => {
        console.log('🟢 WebSocket connected to AssemblyAI v3 streaming');
        
        // For v3 API, authentication is done via the token parameter in URL
        // No additional authentication message needed
        console.log('🔐 Connected with token authentication via URL parameters');
        resolve(); // Resolve immediately as connection is authenticated
      };
      
      this.websocket.onmessage = (event) => {
        console.log('WEBSOCKET_MESSAGE: Received from AssemblyAI:', event.data);
        const data = JSON.parse(event.data);
        const messageType = data.type;
        
        // Log all message types for debugging
        console.log('WEBSOCKET_MESSAGE_TYPE:', messageType, 'Full data:', data);
        
        if (messageType === "Begin") {
          console.log('SESSION_BEGIN:', data.session_id);
          console.log('🎤 READY FOR AUDIO - Session started, speak into your tab audio!');
          // Don't resolve here for v3, wait for actual transcripts
        } else if (messageType === "Turn") {
          // v3 API sends Turn messages with transcripts
          const text = data.transcript || "";
          const isFinal = data.end_of_turn || false;
          
          console.log(`🎯 ${isFinal ? 'FINAL' : 'PARTIAL'} TRANSCRIPT RECEIVED:`);
          console.log('   Text:', `"${text}"`);
          console.log('   Length:', text.length);
          console.log('   isFinal:', isFinal);
          console.log('   end_of_turn_confidence:', data.end_of_turn_confidence);
          
          if (text.trim()) {
            // Force show overlay for transcript
            this.forceShowOverlay(text, isFinal);
            
            // Send transcript using helper method
            this.sendTranscriptToTab(text, isFinal);
            
            // Save to full transcript if final
            if (isFinal) {
              this.transcript += (this.transcript ? ' ' : '') + text;
              console.log('💾 SAVED_TO_TRANSCRIPT:', text);
              console.log('📊 FULL_TRANSCRIPT_LENGTH:', this.transcript.length);
            }
          }
        } else if (messageType === "End") {
          console.log('⏹ SESSION_END: Session terminated');
        } else {
          console.log('🔍 WEBSOCKET_OTHER:', messageType, data);
          
          // Check if this is an error message
          if (data.error || data.message) {
            console.error('🚨 ASSEMBLYAI_ERROR:', data);
          }
        }
      };
      
      // Add a test message sender
      setTimeout(() => {
        console.log('🧪 TEST: Forcing a test transcript display...');
        this.forceShowOverlay('Test transcript - if you see this, the overlay system works!', false);
      }, 3000);
      
      this.websocket.onerror = (error) => {
        console.error('🔴 WebSocket error:', error);
        reject(error);
      };
      
      this.websocket.onclose = (event) => {
        console.log('🔒 WebSocket closed with code:', event.code, 'reason:', event.reason);
        this.isTranscribing = false;
      };
    });
  }
  
  
  sendTranscriptToTab(text, isFinal) {
    // Send transcript to the tab being transcribed (not the active tab)
    if (this.currentTranscriptionTabId) {
      console.log('📤 SENDING to transcription tab:', { text, isFinal, tabId: this.currentTranscriptionTabId });
      chrome.tabs.sendMessage(this.currentTranscriptionTabId, {
        type: 'NEW_TRANSCRIPT',
        text: text,
        isFinal: isFinal
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ FAILED to send transcript to transcription tab:', chrome.runtime.lastError.message);
        } else {
          console.log('✅ SENT transcript to transcription tab:', response);
        }
      });
    } else {
      // Fallback to active tab (old behavior)
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          console.log('📤 SENDING to active tab (fallback):', { text, isFinal, tabId: tabs[0].id });
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'NEW_TRANSCRIPT',
            text: text,
            isFinal: isFinal
          }, (response) => {
            if (chrome.runtime.lastError) {
              console.error('❌ FAILED to send transcript to content script:', chrome.runtime.lastError.message);
            } else {
              console.log('✅ SENT transcript to content script:', response);
            }
          });
        }
      });
    }
  }

  forceShowOverlay(text, isFinal) {
    console.log('🎨 FORCE_OVERLAY:', { text, isFinal });
    
    // First try to send to the tracked transcription tab
    if (this.currentTranscriptionTabId) {
      chrome.tabs.sendMessage(this.currentTranscriptionTabId, {
        type: 'NEW_TRANSCRIPT',
        text: text,
        isFinal: isFinal,
        forceShow: true
      }, (response) => {
        if (!chrome.runtime.lastError) {
          console.log(`✅ SENT transcript to tracked tab ${this.currentTranscriptionTabId}:`, response);
        } else {
          console.log(`❌ Failed to send to tracked tab, trying all tabs...`);
          this.sendToAllTabs(text, isFinal);
        }
      });
    } else {
      // Fallback: send to all tabs
      this.sendToAllTabs(text, isFinal);
    }
  }
  
  sendToAllTabs(text, isFinal) {
    chrome.tabs.query({}, (tabs) => {
      // Prioritize media tabs (YouTube, etc.)
      const mediaTabs = tabs.filter(tab => 
        tab.url && (
          tab.url.includes('youtube.com') || 
          tab.url.includes('netflix.com') || 
          tab.url.includes('twitch.tv') ||
          tab.audible
        )
      );
      
      const targetTabs = mediaTabs.length > 0 ? mediaTabs : tabs;
      
      targetTabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'NEW_TRANSCRIPT',
          text: text,
          isFinal: isFinal,
          forceShow: true
        }, (response) => {
          if (!chrome.runtime.lastError) {
            console.log(`✅ SENT transcript to tab ${tab.id} (${tab.url || 'unknown'}):`, response);
          }
        });
      });
    });
  }
  
  
  
  async setupOffscreenDocument() {
    console.log('BG: Setting up offscreen document...');
    
    // Check if offscreen document already exists
    const hasDocument = await chrome.offscreen.hasDocument?.();
    console.log('BG: Offscreen document exists?', hasDocument);
    
    if (hasDocument) {
      console.log('BG: Using existing offscreen document');
      return;
    }
    
    console.log('BG: Creating new offscreen document...');
    
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Processing tab audio for real-time transcription with AudioWorklet'
      });
      console.log('✅ BG: Offscreen document created successfully');
      
      // Wait a moment for offscreen document to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      console.error('❌ BG: Failed to create offscreen document:', error);
      throw error;
    }
  }
  
  stopTranscription() {
    console.log('🛑 BG: Stopping all transcription services...');
    
    // Close WebSocket connection
    if (this.websocket) {
      console.log('🔌 BG: Closing WebSocket connection...');
      this.websocket.close();
      this.websocket = null;
    }
    
    // Audio capture is now stopped by content script directly
    
    // Clean up any legacy audio processing
    if (this.audioProcessor) {
      console.log('🎵 BG: Disconnecting legacy audio processor...');
      this.audioProcessor.disconnect();
      this.audioProcessor = null;
    }
    
    if (this.capturedStream) {
      console.log('📹 BG: Stopping captured stream tracks...');
      this.capturedStream.getTracks().forEach(track => track.stop());
      this.capturedStream = null;
    }
    
    if (this.mediaStream) {
      console.log('🎤 BG: Stopping media stream tracks...');
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    if (this.audioContext) {
      console.log('🔊 BG: Closing audio context...');
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Clear transcription state
    this.isTranscribing = false;
    this.currentTranscriptionTabId = null;
    this.audioChunkCount = 0;
    
    // Notify all content scripts that transcription stopped
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'TRANSCRIPTION_STOPPED'
        }, () => {
          // Ignore errors for tabs that don't have content scripts
          if (chrome.runtime.lastError) {
            // Silent ignore - many tabs won't have our content script
          }
        });
      });
    });
    
    console.log('✅ BG: All transcription services stopped successfully');
  }
  
  async askAiQuestion(question) {
    if (!this.openAiApiKey) {
      throw new Error('OpenAI API key not configured');
    }
    
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.openAiApiKey}`
        },
        body: JSON.stringify({
          model: 'gpt-4',
          messages: [
            {
              role: 'system',
              content: 'You are a helpful assistant. Answer questions about the provided transcript in a clear, organized manner.'
            },
            {
              role: 'user',
              content: `Here is the transcript: "${this.transcript}"\n\nQuestion: ${question}`
            }
          ],
          max_tokens: 500,
          temperature: 0.5
        })
      });
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }
      
      const data = await response.json();
      return data.choices[0].message.content;
    } catch (error) {
      console.error('Failed to get AI response:', error);
      throw error;
    }
  }
}

// Global service instance
const transcriptionService = new TranscriptionService();

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('BG: Received message:', request.type, 'from:', sender.tab?.id || 'popup');
  
  switch (request.type) {
    case 'START_TRANSCRIPTION':
      console.log('BG: 🚀 START_TRANSCRIPTION received with streamId:', request.streamId, 'tabId:', request.tabId);
      (async () => {
        try {
          await transcriptionService.startTranscription(request.tabId, request.streamId);
          console.log('BG: ✅ Transcription started successfully, sending success response');
          sendResponse({success: true});
        } catch (error) {
          console.error('BG: ❌ Transcription start failed:', error);
          sendResponse({success: false, error: error.message});
        }
      })();
      return true; // Keep message channel open for async response
      
    case 'STOP_TRANSCRIPTION':
      console.log('📨 STOP_TRANSCRIPTION message received from:', sender.tab?.id || 'popup');
      
      // Stop all transcription services
      transcriptionService.stopTranscription();
      
      // Send stop message to content scripts to stop their audio capture
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'STOP_AUDIO_CAPTURE'
          }, () => {
            // Ignore errors for tabs that don't have content scripts
            if (chrome.runtime.lastError) {
              // Silent ignore
            }
          });
        });
      });
      
      sendResponse({success: true});
      break;
      
    case 'SAVE_API_KEYS':
      transcriptionService.saveApiKeys(request.assemblyAiKey, request.openAiKey);
      sendResponse({success: true});
      break;
      
    case 'ASK_AI_QUESTION':
      transcriptionService.askAiQuestion(request.question)
        .then(answer => sendResponse({success: true, answer}))
        .catch(error => sendResponse({success: false, error: error.message}));
      return true; // Keep message channel open for async response
      
    case 'GET_TRANSCRIPT':
      sendResponse({success: true, transcript: transcriptionService.transcript});
      break;
      
    case 'AUDIO_DATA_FROM_OFFSCREEN':
      // Forward audio data from offscreen document (AudioWorklet) to AssemblyAI WebSocket
      if (transcriptionService.websocket?.readyState === WebSocket.OPEN) {
        try {
          // Convert array back to Int16Array for AssemblyAI
          const int16Array = new Int16Array(request.data);
          
          // Send as binary data (ArrayBuffer) to AssemblyAI
          transcriptionService.websocket.send(int16Array.buffer);
          
          // Track audio activity for debugging
          transcriptionService.audioChunkCount = (transcriptionService.audioChunkCount || 0) + 1;
          
          // Log audio activity periodically to avoid spam
          if (request.amplitude > 100) {
            if (transcriptionService.audioChunkCount % 20 === 0) { // Log every 20th active chunk
              console.log('🎵 BG_AUDIO: Sent to AssemblyAI - chunk:', transcriptionService.audioChunkCount, 
                         'amplitude:', request.amplitude, 'samples:', int16Array.length, 
                         'sampleRate:', request.sampleRate);
            }
          } else if (transcriptionService.audioChunkCount % 100 === 0) { // Log every 100th silent chunk
            console.log('🔇 BG_AUDIO: Silent chunk sent - total chunks:', transcriptionService.audioChunkCount);
          }
          
        } catch (error) {
          console.error('❌ BG_AUDIO: Error processing audio data:', error);
        }
      } else {
        console.warn('❌ BG_AUDIO: WebSocket not open, dropping audio data. State:', 
          transcriptionService.websocket?.readyState || 'null');
      }
      sendResponse({success: true});
      break;
      
      
      
    case 'SET_TRANSCRIPTION_SOURCE':
      console.log('📍 SET_TRANSCRIPTION_SOURCE:', request.sourceInfo);
      // Try to find the tab being captured based on the video track label
      chrome.tabs.query({}, (tabs) => {
        // Look for media tabs that might be the source
        const mediaTabs = tabs.filter(tab => 
          tab.url.includes('youtube.com') || 
          tab.url.includes('netflix.com') || 
          tab.url.includes('twitch.tv') ||
          tab.audible ||
          (request.sourceInfo.label && request.sourceInfo.label.includes(tab.title))
        );
        
        if (mediaTabs.length > 0) {
          // Use the first media tab as transcription target
          transcriptionService.currentTranscriptionTabId = mediaTabs[0].id;
          console.log('🎯 SET transcription target tab:', mediaTabs[0].id, 'URL:', mediaTabs[0].url);
        }
      });
      sendResponse({success: true});
      break;
      
    case 'AUDIO_CAPTURE_STOPPED':
      transcriptionService.isTranscribing = false;
      transcriptionService.currentTranscriptionTabId = null; // Clear target
      
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'TRANSCRIPTION_STOPPED'
          });
        }
      });
      sendResponse({success: true});
      break;
      
    default:
      sendResponse({success: false, error: 'Unknown message type'});
  }
});

// Handle tab updates
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && transcriptionService.isTranscribing) {
    // Notify content script that transcription is running
    chrome.tabs.sendMessage(tabId, {
      type: 'TRANSCRIPTION_STATUS',
      isRunning: true
    });
  }
});

// Service worker startup
console.log('🎤 BG: Live Transcription Assistant background service loaded at:', new Date().toISOString());

// Handle service worker errors
self.addEventListener('error', (event) => {
  console.error('BG: Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  console.error('BG: Unhandled promise rejection:', event.reason);
});