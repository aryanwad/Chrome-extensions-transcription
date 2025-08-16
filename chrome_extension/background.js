// Background service worker for Live Transcription Assistant with Secure Backend

class TranscriptionService {
  constructor() {
    this.websocket = null;
    this.mediaStream = null;
    this.audioContext = null;
    this.isTranscribing = false;
    this.userAuth = null;
    this.transcript = '';
    this.authLoaded = false;
    this.currentTranscriptionTabId = null;
    this.capturedStream = null;
    this.audioProcessor = null;
    
    // Backend configuration
    this.backendUrl = 'https://gak2qkt4df.execute-api.us-east-1.amazonaws.com/dev';
    
    // Catch-up feature properties
    this.catchupTasks = new Map(); // Store active catch-up tasks
    
    // Load user authentication from storage
    this.loadUserAuth().then(() => {
      this.authLoaded = true;
    });
  }
  
  async loadUserAuth() {
    try {
      const result = await chrome.storage.local.get(['userAuth']);
      this.userAuth = result.userAuth || null;
      console.log('User auth loaded:', this.userAuth ? 'Logged in' : 'Not logged in');
    } catch (error) {
      console.error('Failed to load user auth:', error);
    }
  }
  
  async saveUserAuth(authData) {
    try {
      await chrome.storage.local.set({ userAuth: authData });
      this.userAuth = authData;
      console.log('User auth saved successfully');
    } catch (error) {
      console.error('Failed to save user auth:', error);
    }
  }
  
  async clearUserAuth() {
    try {
      await chrome.storage.local.remove(['userAuth']);
      this.userAuth = null;
      console.log('User logged out');
    } catch (error) {
      console.error('Failed to clear user auth:', error);
    }
  }
  
  isUserLoggedIn() {
    return !!(this.userAuth && this.userAuth.token);
  }
  
  // API call helper method for secure backend
  async apiCall(endpoint, method = 'GET', data = null) {
    if (!this.userAuth || !this.userAuth.token) {
      throw new Error('User not authenticated');
    }
    
    const url = `${this.backendUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.userAuth.token}`
      }
    };
    
    if (data) {
      options.body = JSON.stringify(data);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.message || `HTTP ${response.status}`);
    }
    
    return await response.json();
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
        return;
      }
      
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
      
      // Wait a moment for scripts to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      throw new Error('Failed to inject content scripts: ' + error.message);
    }
  }
  
  async startTranscription(tabId, streamId, userToken) {
    if (this.isTranscribing) {
      return;
    }
    
    // Wait for authentication to be loaded
    if (!this.authLoaded) {
      await this.loadUserAuth();
      this.authLoaded = true;
    }
    
    if (!this.isUserLoggedIn()) {
      throw new Error('User not logged in');
    }

    try {
      // Set the current tab as transcription target
      this.currentTranscriptionTabId = tabId;
      
      // Step 1: Ensure content scripts are injected
      await this.ensureContentScriptsInjected(tabId);
      
      // Step 2: Connect to AssemblyAI with secure API key from backend
      await this.connectToAssemblyAI();
      
      // Step 3: Set up offscreen document for audio processing
      await this.setupOffscreenDocument();
      
      // Step 4: Start audio capture in offscreen document with stream ID
      const captureResponse = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'START_OFFSCREEN_CAPTURE',
          streamId: streamId
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error('Failed to communicate with offscreen document: ' + chrome.runtime.lastError.message));
            return;
          }
          resolve(response);
        });
      });
      
      if (!captureResponse.success) {
        throw new Error('Offscreen capture failed: ' + (captureResponse.error || 'Unknown error'));
      }
      
      this.isTranscribing = true;
      
      // Start transcript storage session
      chrome.tabs.get(tabId, (tab) => {
        if (tab && tab.url) {
          const streamTitle = tab.title || 'Unknown Stream';
          // Could implement transcript storage here
        }
      });

      // Notify content script that transcription has started
      chrome.tabs.sendMessage(tabId, {
        type: 'TRANSCRIPTION_STARTED'
      }, (response) => {
        if (chrome.runtime.lastError) {
          // Silent ignore
        }
      });
      
    } catch (error) {
      // Clean up on error
      this.stopTranscription();
      throw error;
    }
  }
  
  async connectToAssemblyAI() {
    if (!this.isUserLoggedIn()) {
      throw new Error('User not authenticated');
    }
    
    try {
      // Get API key from secure backend
      const response = await this.apiCall('/transcription/stream', 'POST', {
        action: 'start'
      });
      
      if (!response.success) {
        throw new Error('Failed to get API access: ' + (response.error || 'Unknown error'));
      }
      
      this.sessionId = response.session_id;
      
      // Now connect directly to AssemblyAI with the secure API key
      const params = new URLSearchParams({
        sample_rate: 16000,
        format_turns: true,
        token: response.assemblyai_api_key
      });
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
      
      return new Promise((resolve, reject) => {
        try {
          this.websocket = new WebSocket(wsUrl);
        } catch (error) {
          reject(error);
          return;
        }
        
        this.websocket.onopen = () => {
          console.log('✅ Connected to AssemblyAI streaming with secure API key');
          resolve();
        };
        
        this.websocket.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            console.log('BG: Received AssemblyAI message:', data);
            this.handleTranscriptionData(data);
          } catch (error) {
            console.error('❌ Error parsing transcription data:', error);
          }
        };
        
        this.websocket.onerror = (error) => {
          console.error('❌ WebSocket error:', error);
          reject(error);
        };
        
        this.websocket.onclose = (event) => {
          console.log('🔌 AssemblyAI WebSocket closed:', event.code, event.reason);
          this.websocket = null;
        };
      });
      
    } catch (error) {
      console.error('❌ Failed to connect to AssemblyAI:', error);
      throw error;
    }
  }

  async setupOffscreenDocument() {
    try {
      // Check if offscreen document already exists
      const offscreenUrl = chrome.runtime.getURL('offscreen.html');
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });

      if (existingContexts.length > 0) {
        console.log('✅ Offscreen document already exists');
        return;
      }

      // Create offscreen document
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Tab capture and audio processing for real-time transcription'
      });
      
      console.log('✅ Offscreen document created successfully');
      
      // Wait for offscreen document to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
    } catch (error) {
      console.error('❌ Failed to setup offscreen document:', error);
      throw new Error('Offscreen document setup failed: ' + error.message);
    }
  }

  // Handle audio data from offscreen document and send to AssemblyAI
  handleAudioData(audioData) {
    if (!this.isTranscribing || !this.websocket || this.websocket.readyState !== WebSocket.OPEN) {
      return;
    }

    // Send audio data directly to AssemblyAI WebSocket
    try {
      this.websocket.send(audioData);
    } catch (error) {
      console.error('❌ Failed to send audio to AssemblyAI:', error);
    }
  }
  
  handleTranscriptionData(data) {
    if (!data || !this.currentTranscriptionTabId) return;
    
    // Handle AssemblyAI v3 response format
    if (data.transcript) {
      const transcriptText = data.transcript.trim();
      if (transcriptText.length === 0) return;
      
      // Update stored transcript - store both partial and final
      if (data.end_of_turn) {
        // Final transcript - replace the last partial with final version
        this.transcript += transcriptText + ' ';
      }
      
      // Send to content script for display
      chrome.tabs.sendMessage(this.currentTranscriptionTabId, {
        type: 'NEW_TRANSCRIPT',
        transcript: transcriptText,
        isFinal: data.end_of_turn || false,
        confidence: data.confidence || 0.8
      }, () => {
        if (chrome.runtime.lastError) {
          // Silent ignore for content script communication errors
        }
      });
    }
  }

  stopTranscription() {
    console.log('📨 Stopping transcription...');
    
    this.isTranscribing = false;
    
    // Stop backend streaming
    if (this.isUserLoggedIn()) {
      this.apiCall('/transcription/stream', 'POST', {
        action: 'stop'
      }).catch(error => {
        console.error('Failed to stop backend stream:', error);
      });
    }
    
    // Clean up WebSocket if exists
    if (this.websocket) {
      this.websocket.close(1000, 'User stopped transcription');
      this.websocket = null;
    }
    
    // Clean up offscreen document
    this.cleanupOffscreenDocument();
    
    // Clean up other resources
    this.transcript = '';
    this.currentTranscriptionTabId = null;
    
    console.log('✅ Transcription stopped and cleaned up');
  }

  async cleanupOffscreenDocument() {
    try {
      // Send cleanup message to offscreen document
      chrome.runtime.sendMessage({
        type: 'CLEANUP_OFFSCREEN'
      }, () => {
        if (chrome.runtime.lastError) {
          // Silent ignore
        }
      });
      
      // Close offscreen document
      const offscreenUrl = chrome.runtime.getURL('offscreen.html');
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [offscreenUrl]
      });

      if (existingContexts.length > 0) {
        await chrome.offscreen.closeDocument();
        console.log('✅ Offscreen document closed');
      }
    } catch (error) {
      console.error('❌ Failed to cleanup offscreen document:', error);
    }
  }

  async askAiQuestion(question) {
    if (!this.isUserLoggedIn()) {
      throw new Error('User not logged in');
    }
    
    if (!this.transcript || this.transcript.trim().length === 0) {
      throw new Error('No transcript available. Please start transcription first and wait for some content to be transcribed.');
    }

    try {
      // Use backend for AI questions instead of direct OpenAI call
      const response = await this.apiCall('/transcription/ask', 'POST', {
        question: question,
        transcript: this.transcript
      });
      
      return response.answer;
    } catch (error) {
      console.error('❌ AI question failed:', error);
      throw error;
    }
  }

  // Catch-up functionality using secure backend
  async requestCatchup(streamUrl, duration) {
    if (!this.isUserLoggedIn()) {
      throw new Error('User not logged in');
    }

    try {
      console.log('🎯 Requesting catch-up via secure backend...');
      
      const response = await this.apiCall('/transcription/catchup', 'POST', {
        stream_url: streamUrl,
        duration_minutes: duration,
        user_id: this.userAuth.user.user_id || 'unknown'
      });
      
      if (response.success) {
        console.log('✅ Catch-up completed successfully');
        return response;
      } else {
        throw new Error(response.error || 'Catch-up failed');
      }
    } catch (error) {
      console.error('❌ Catch-up request failed:', error);
      throw error;
    }
  }
}

// Initialize transcription service
const transcriptionService = new TranscriptionService();

// Message handlers
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'START_TRANSCRIPTION':
      (async () => {
        try {
          await transcriptionService.startTranscription(request.tabId, request.streamId, request.userToken);
          sendResponse({success: true});
        } catch (error) {
          sendResponse({success: false, error: error.message});
        }
      })();
      return true; // Keep message channel open for async response
      
    case 'STOP_TRANSCRIPTION':
      transcriptionService.stopTranscription();
      
      // Send stop message to content scripts
      chrome.tabs.query({}, (tabs) => {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, {
            type: 'STOP_AUDIO_CAPTURE'
          }, () => {
            if (chrome.runtime.lastError) {
              // Silent ignore
            }
          });
        });
      });
      
      sendResponse({success: true});
      break;
      
    case 'ASK_AI_QUESTION':
      transcriptionService.askAiQuestion(request.question)
        .then(answer => sendResponse({success: true, answer}))
        .catch(error => sendResponse({success: false, error: error.message}));
      return true; // Keep message channel open for async response
      
    case 'REQUEST_CATCHUP':
      transcriptionService.requestCatchup(request.streamUrl, request.duration)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({success: false, error: error.message}));
      return true; // Keep message channel open for async response
      
    case 'GET_TRANSCRIPTION_STATUS':
      sendResponse({
        isTranscribing: transcriptionService.isTranscribing,
        isLoggedIn: transcriptionService.isUserLoggedIn()
      });
      break;
      
    // Handle audio data from offscreen document
    case 'AUDIO_DATA_FROM_OFFSCREEN':
      // Convert array back to Int16Array and create ArrayBuffer
      const audioArray = new Int16Array(request.data);
      const audioBuffer = audioArray.buffer;
      transcriptionService.handleAudioData(audioBuffer);
      sendResponse({success: true});
      break;
      
    default:
      console.warn('Unknown message type:', request.type);
      sendResponse({success: false, error: 'Unknown message type'});
  }
});

// Audio data handled in main message listener above

console.log('🎤 Live Transcription background service loaded with secure backend authentication');