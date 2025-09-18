// Background service worker for Live Transcription Assistant with Secure Backend
// This file handles the core transcription service, WebSocket connections, and catch-up functionality

/**
 * MAIN TRANSCRIPTION SERVICE CLASS
 * Manages real-time transcription, user authentication, and audio processing
 */
class TranscriptionService {
  constructor() {
    // WebSocket and audio processing state
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
    
    // Backend configuration - secure API endpoint
    this.backendUrl = 'https://gak2qkt4df.execute-api.us-east-1.amazonaws.com/dev';
    
    // Catch-up feature properties for stream summaries
    this.catchupTasks = new Map();
    
    // Session tracking for credit management
    this.sessionId = null;
    this.transcriptionStartTime = null;
    
    // Initialize the service
    this.init();
  }

  /**
   * INITIALIZATION
   * Load user authentication and set up event listeners
   */
  async init() {
    try {
      await this.loadUserAuth();
    } catch (error) {
      console.error('Failed to initialize service:', error);
    }
  }

  /**
   * USER AUTHENTICATION MANAGEMENT
   * Handles JWT token storage and validation
   */
  async loadUserAuth() {
    try {
      const result = await chrome.storage.local.get(['userAuth']);
      if (result.userAuth) {
        this.userAuth = result.userAuth;
        this.authLoaded = true;
      } else {
        this.authLoaded = true;
      }
    } catch (error) {
      console.error('Error loading user auth:', error);
      this.authLoaded = true;
    }
  }

  isUserLoggedIn() {
    return this.authLoaded && this.userAuth && this.userAuth.token;
  }

  /**
   * MAIN TRANSCRIPTION FLOW
   * Starts real-time transcription with tab capture
   */
  async startTranscription(streamId, tabId, userToken) {
    try {
      if (!this.isUserLoggedIn()) {
        throw new Error('User not authenticated');
      }

      // Store user token for API calls
      this.userAuth = { token: userToken };
      this.currentTranscriptionTabId = tabId;

      // Set up offscreen document for audio processing
      await this.setupOffscreenDocument();

      // Connect to AssemblyAI WebSocket with secure API key
      await this.connectToAssemblyAI();

      // Start audio capture from tab
      await this.startAudioCapture(streamId);

      this.isTranscribing = true;
      return { success: true, message: 'Transcription started successfully' };

    } catch (error) {
      console.error('Error starting transcription:', error);
      await this.cleanup();
      throw error;
    }
  }

  /**
   * ASSEMBLYAI WEBSOCKET CONNECTION
   * Connects to AssemblyAI with secure API key from backend
   */
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
      this.transcriptionStartTime = Date.now();
      
      // Connect to AssemblyAI WebSocket
      const params = new URLSearchParams({
        sample_rate: 16000,
        format_turns: true,
        token: response.assemblyai_api_key
      });
      const wsUrl = `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
      
      this.websocket = new WebSocket(wsUrl);
      this.setupWebSocketHandlers();
      
      // Wait for connection
      await new Promise((resolve, reject) => {
        this.websocket.onopen = resolve;
        this.websocket.onerror = reject;
      });

    } catch (error) {
      console.error('Failed to connect to AssemblyAI:', error);
      throw error;
    }
  }

  /**
   * WEBSOCKET EVENT HANDLERS
   * Handles incoming transcription results from AssemblyAI
   */
  setupWebSocketHandlers() {
    this.websocket.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleTranscriptionResult(data);
      } catch (error) {
        console.error('Error parsing WebSocket message:', error);
      }
    };

    this.websocket.onclose = () => {
      if (this.isTranscribing) {
        console.warn('WebSocket closed unexpectedly');
      }
    };

    this.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
  }

  /**
   * TRANSCRIPTION RESULT PROCESSING
   * Processes and filters transcription results before sending to UI
   */
  handleTranscriptionResult(data) {
    if (data.type === 'Turn' && data.transcript) {
      // Filter out very short or low-confidence transcripts
      if (data.transcript.length > 3 || data.confidence > 0.1) {
        // Send to content script for display
        if (this.currentTranscriptionTabId) {
          chrome.tabs.sendMessage(this.currentTranscriptionTabId, {
            type: 'NEW_TRANSCRIPT',
            text: data.transcript,
            isFinal: data.end_of_turn || false,
            confidence: data.confidence || 0
          }).catch(() => {
            // Content script may not be available - this is normal
          });
        }
        
        // Update stored transcript for Ask Agent feature
        if (data.end_of_turn) {
          this.transcript += data.transcript + ' ';
        }
      }
    }
  }

  /**
   * OFFSCREEN DOCUMENT SETUP
   * Creates offscreen document for audio processing (Chrome requirement)
   */
  async setupOffscreenDocument() {
    const existingContexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [chrome.runtime.getURL('offscreen.html')]
    });

    if (existingContexts.length === 0) {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Audio capture and processing for real-time transcription'
      });
    }
  }

  /**
   * AUDIO CAPTURE FROM TAB
   * Starts capturing audio from the specified tab using Chrome's tabCapture API
   */
  async startAudioCapture(streamId) {
    // Send stream ID to offscreen document for processing
    await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        type: 'START_OFFSCREEN_CAPTURE',
        streamId: streamId
      }, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else if (response && response.success) {
          resolve();
        } else {
          reject(new Error('Failed to start audio capture'));
        }
      });
    });
  }

  /**
   * STOP TRANSCRIPTION
   * Cleanly stops transcription and cleans up resources
   */
  async stopTranscription() {
    try {
      this.isTranscribing = false;
      
      // Stop session on backend
      if (this.sessionId) {
        await this.apiCall('/transcription/stream', 'POST', {
          action: 'stop',
          session_id: this.sessionId
        });
      }
      
      await this.cleanup();
      return { success: true, message: 'Transcription stopped successfully' };
      
    } catch (error) {
      console.error('Error stopping transcription:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * RESOURCE CLEANUP
   * Cleans up WebSocket, audio contexts, and offscreen document
   */
  async cleanup() {
    // Close WebSocket connection
    if (this.websocket) {
      this.websocket.close();
      this.websocket = null;
    }

    // Clean up offscreen document
    try {
      const existingContexts = await chrome.runtime.getContexts({
        contextTypes: ['OFFSCREEN_DOCUMENT'],
        documentUrls: [chrome.runtime.getURL('offscreen.html')]
      });
      
      if (existingContexts.length > 0) {
        await chrome.offscreen.closeDocument();
      }
    } catch (error) {
      // Offscreen document may already be closed
    }

    // Reset state
    this.currentTranscriptionTabId = null;
    this.sessionId = null;
    this.transcript = '';
  }

  /**
   * CATCH-UP FEATURE
   * Downloads and transcribes past stream content for summaries
   */
  async processCatchup(streamUrl, duration, userToken) {
    try {
      this.userAuth = { token: userToken };
      const taskId = Date.now().toString();
      
      // Initialize catch-up task tracking
      this.catchupTasks.set(taskId, {
        status: 'starting',
        progress: 0,
        streamUrl,
        duration
      });

      // Step 1: Download video segments using m3u8 downloader
      this.broadcastProgress('download', { stage: 'starting', message: 'Initializing stream download...' });
      
      const downloader = new M3U8Downloader();
      const videoResult = await downloader.downloadStream(
        streamUrl, 
        duration,
        (progress) => {
          // Send progress updates to popup
          this.broadcastProgress('download', progress);
        }
      );
      
      // Step 2: Extract audio from video segments
      this.broadcastProgress('audio_extraction', { stage: 'processing', message: 'Extracting audio from segments...' });
      
      const audioResult = await this.extractAudioFromSegments(videoResult.buffer, duration);
      
      // Step 3: Upload audio and get transcription
      this.broadcastProgress('transcription', { stage: 'uploading', message: 'Uploading audio for transcription...' });
      
      const uploader = new ChunkedAudioUploader(this.backendUrl, userToken);
      const result = await uploader.uploadAudioForTranscription(audioResult.audioBuffer, {
        streamUrl: streamUrl,
        duration: duration,
        taskId: taskId
      });

      // Clean up task tracking
      this.catchupTasks.delete(taskId);
      
      return {
        success: true,
        summary: result.summary,
        transcript: result.transcript,
        processingTime: result.processing_time
      };

    } catch (error) {
      console.error('Catch-up processing error:', error);
      this.catchupTasks.delete(taskId);
      throw error;
    }
  }

  /**
   * AUDIO EXTRACTION FROM VIDEO SEGMENTS
   * Converts video buffer to audio for transcription
   */
  async extractAudioFromSegments(videoBuffer, duration) {
    try {
      // Create audio context for processing
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      
      // Decode video buffer to extract audio
      const audioBuffer = await audioContext.decodeAudioData(videoBuffer.slice());
      
      // Convert to 16kHz mono PCM for AssemblyAI
      const targetSampleRate = 16000;
      const sourceData = audioBuffer.getChannelData(0);
      const targetLength = Math.floor(sourceData.length * (targetSampleRate / audioBuffer.sampleRate));
      const resampledData = new Float32Array(targetLength);
      
      // Simple linear interpolation resampling
      for (let i = 0; i < targetLength; i++) {
        const sourceIndex = (i * sourceData.length) / targetLength;
        const index = Math.floor(sourceIndex);
        const fraction = sourceIndex - index;
        
        if (index + 1 < sourceData.length) {
          resampledData[i] = sourceData[index] * (1 - fraction) + sourceData[index + 1] * fraction;
        } else {
          resampledData[i] = sourceData[index];
        }
      }
      
      // Convert to 16-bit PCM
      const pcmData = new Int16Array(resampledData.length);
      for (let i = 0; i < resampledData.length; i++) {
        pcmData[i] = Math.max(-32768, Math.min(32767, Math.floor(resampledData[i] * 32767)));
      }
      
      return {
        audioBuffer: pcmData.buffer,
        sampleRate: targetSampleRate,
        duration: targetLength / targetSampleRate
      };
      
    } catch (error) {
      console.error('Audio extraction error:', error);
      throw new Error('Failed to extract audio from video segments');
    }
  }

  /**
   * ASK AGENT FEATURE
   * Uses OpenAI GPT-4 to answer questions about transcribed content
   */
  async askAgent(question, userToken) {
    try {
      this.userAuth = { token: userToken };
      
      if (!this.transcript || this.transcript.trim().length === 0) {
        throw new Error('No transcript available. Please start transcription first.');
      }

      const response = await this.apiCall('/transcription/ask', 'POST', {
        question: question,
        transcript: this.transcript.trim()
      });

      if (response && response.success) {
        return {
          success: true,
          answer: response.answer,
          confidence: response.confidence || 0.9
        };
      } else {
        throw new Error(response?.error || 'Failed to get AI response');
      }

    } catch (error) {
      console.error('Ask Agent error:', error);
      throw error;
    }
  }

  /**
   * PROGRESS BROADCASTING
   * Sends progress updates to popup and content scripts
   */
  broadcastProgress(stage, progress) {
    // Send to popup if open
    chrome.runtime.sendMessage({
      type: 'CATCHUP_PROGRESS',
      stage: stage,
      progress: progress
    }).catch(() => {
      // Popup may not be open
    });
  }

  /**
   * SECURE API CALLS
   * Makes authenticated requests to the backend API
   */
  async apiCall(endpoint, method = 'GET', data = null) {
    if (!this.userAuth || !this.userAuth.token) {
      throw new Error('User not authenticated');
    }

    const url = `${this.backendUrl}${endpoint}`;
    const options = {
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.userAuth.token}`
      }
    };

    if (data && method !== 'GET') {
      options.body = JSON.stringify(data);
    }

    const response = await fetch(url, options);
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`API call failed: ${response.status} ${error}`);
    }

    return await response.json();
  }
}

/**
 * MESSAGE HANDLER FOR OFFSCREEN DOCUMENT
 * Processes audio data from offscreen document and forwards to WebSocket
 */
function handleOffscreenMessage(message) {
  if (message.type === 'AUDIO_DATA_FROM_OFFSCREEN' && transcriptionService.websocket) {
    // Forward audio data to AssemblyAI WebSocket
    if (transcriptionService.websocket.readyState === WebSocket.OPEN) {
      transcriptionService.websocket.send(message.audioData);
    }
  }
}

/**
 * CHROME RUNTIME MESSAGE HANDLER
 * Handles messages from popup, content scripts, and offscreen document
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Handle different message types
  switch (message.type) {
    case 'START_TRANSCRIPTION':
      transcriptionService.startTranscription(message.streamId, message.tabId, message.userToken)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Async response
      
    case 'STOP_TRANSCRIPTION':
      transcriptionService.stopTranscription()
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Async response
      
    case 'START_CATCHUP':
      transcriptionService.processCatchup(message.streamUrl, message.duration, message.userToken)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Async response
      
    case 'ASK_AGENT':
      transcriptionService.askAgent(message.question, message.userToken)
        .then(result => sendResponse(result))
        .catch(error => sendResponse({ success: false, error: error.message }));
      return true; // Async response
      
    case 'AUDIO_DATA_FROM_OFFSCREEN':
      handleOffscreenMessage(message);
      break;
      
    default:
      // Unknown message type
      break;
  }
});

/**
 * DYNAMIC MODULE LOADING
 * Loads required modules for catch-up functionality
 */
function loadServiceWorkerModules() {
  try {
    importScripts('twitch-api.js');
    importScripts('m3u8-downloader.js');
    importScripts('audio-uploader.js');
  } catch (error) {
    console.error('Failed to load service worker modules:', error);
  }
}

// Load modules and initialize service
loadServiceWorkerModules();
const transcriptionService = new TranscriptionService();