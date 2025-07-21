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
  
  async startTranscription(tabId) {
    if (this.isTranscribing) {
      console.log('Transcription already running');
      return;
    }
    
    // Wait for API keys to be loaded
    if (!this.keysLoaded) {
      console.log('WAIT: Waiting for API keys to load...');
      await this.loadApiKeys();
      this.keysLoaded = true;
    }
    
    if (!this.assemblyAiApiKey) {
      throw new Error('AssemblyAI API key not configured');
    }
    
    try {
      // First, ensure content scripts are injected
      console.log('BG_STEP_1: Injecting content scripts...');
      await this.ensureContentScriptsInjected(tabId);
      
      // Connect to AssemblyAI
      console.log('BG_STEP_2: Connecting to AssemblyAI...');
      await this.connectToAssemblyAI();
      
      // Request audio capture from content script
      console.log('BG_STEP_3: Requesting audio capture from content script...');
      
      const response = await new Promise((resolve, reject) => {
        chrome.tabs.sendMessage(tabId, {
          type: 'START_AUDIO_CAPTURE'
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('BG_ERROR: Failed to send message to content script:', chrome.runtime.lastError);
            reject(new Error('Content script not available: ' + chrome.runtime.lastError.message));
            return;
          }
          console.log('BG_STEP_4: Got response from content script:', response);
          resolve(response);
        });
      });
      
      if (!response || !response.success) {
        const errorMsg = response?.error || 'Failed to start audio capture';
        
        // Send error to content script for display
        chrome.tabs.sendMessage(tabId, {
          type: 'AUDIO_CAPTURE_ERROR',
          error: errorMsg
        });
        
        throw new Error(errorMsg);
      }
      
      this.isTranscribing = true;
      console.log('✅ Transcription started');
      
      // Notify content script
      chrome.tabs.sendMessage(tabId, {
        type: 'TRANSCRIPTION_STARTED'
      });
      
    } catch (error) {
      console.error('Failed to start transcription:', error);
      throw error;
    }
  }
  
  async connectToAssemblyAI() {
    console.log('WEBSOCKET_STEP_1: Connecting to AssemblyAI...');
    
    if (!this.assemblyAiApiKey) {
      throw new Error('ERROR_NO_ASSEMBLYAI_KEY: AssemblyAI API key not found');
    }
    
    // Try token-based authentication (if supported by v3 API)
    const params = new URLSearchParams({
      sample_rate: 16000,
      format_turns: true,
      token: this.assemblyAiApiKey  // Try passing API key as token parameter
    });
    const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
    
    console.log('WEBSOCKET_STEP_2: Connecting to:', wsUrl.replace(this.assemblyAiApiKey, '[API_KEY_HIDDEN]'));
    
    return new Promise((resolve, reject) => {
      try {
        this.websocket = new WebSocket(wsUrl);
      } catch (error) {
        console.error('WEBSOCKET_ERROR: Failed to create WebSocket:', error);
        reject(error);
        return;
      }
      
      this.websocket.onopen = () => {
        console.log('🟢 WebSocket connected to AssemblyAI v3 (token auth)');
        resolve();
      };
      
      this.websocket.onmessage = (event) => {
        console.log('WEBSOCKET_MESSAGE: Received from AssemblyAI:', event.data);
        const data = JSON.parse(event.data);
        const typ = data.type;
        
        if (typ === "Begin") {
          console.log('SESSION_BEGIN:', data.id);
        } else if (typ === "Turn") {
          const text = data.transcript || "";
          const isFinal = data.turn_is_formatted || false;
          
          console.log(isFinal ? 'FINAL_TRANSCRIPT:' : 'PARTIAL_TRANSCRIPT:', text);
          
          // Always update UI with latest transcript
          chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0]) {
              chrome.tabs.sendMessage(tabs[0].id, {
                type: 'NEW_TRANSCRIPT',
                text: text,
                isFinal: isFinal
              }, (response) => {
                if (chrome.runtime.lastError) {
                  console.warn('Could not send transcript to content script:', chrome.runtime.lastError.message);
                }
              });
            }
          });
          
          // Only save to full transcript when fully formatted
          if (isFinal && text.trim()) {
            this.transcript += (this.transcript ? ' ' : '') + text;
            console.log('SAVED_TO_TRANSCRIPT:', text);
            console.log('FULL_TRANSCRIPT_LENGTH:', this.transcript.length);
          }
        } else if (typ === "Termination") {
          const duration = data.audio_duration_seconds || 0;
          console.log('SESSION_END:', `Session ended after ${duration.toFixed(2)}s`);
        } else {
          console.log('WEBSOCKET_OTHER:', typ, data);
        }
      };
      
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
  
  
  stopTranscription() {
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }
    
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => track.stop());
      this.mediaStream = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    this.isTranscribing = false;
    console.log('🛑 Transcription stopped');
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
  console.log('Background received message:', request);
  
  switch (request.type) {
    case 'START_TRANSCRIPTION':
      chrome.tabs.query({active: true, currentWindow: true}, async (tabs) => {
        try {
          await transcriptionService.startTranscription(tabs[0].id);
          sendResponse({success: true});
        } catch (error) {
          sendResponse({success: false, error: error.message});
        }
      });
      return true; // Keep message channel open for async response
      
    case 'STOP_TRANSCRIPTION':
      transcriptionService.stopTranscription();
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
      
    case 'AUDIO_DATA':
      // Forward audio data to AssemblyAI WebSocket
      if (transcriptionService.websocket?.readyState === WebSocket.OPEN) {
        // Convert array back to Int16Array
        const int16Array = new Int16Array(request.data);
        transcriptionService.websocket.send(int16Array.buffer);
        console.log('AUDIO_SENT: Sent', int16Array.length, 'audio samples to AssemblyAI');
      } else {
        console.warn('AUDIO_DROPPED: WebSocket not open, state:', 
          transcriptionService.websocket?.readyState || 'null');
      }
      sendResponse({success: true});
      break;
      
    case 'AUDIO_CAPTURE_STOPPED':
      transcriptionService.isTranscribing = false;
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

console.log('🎤 Live Transcription Assistant background service loaded');