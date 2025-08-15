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
    
    // Catch-up feature properties
    this.catchupTasks = new Map(); // Store active catch-up tasks
    this.backendUrl = 'https://03pty1x73i.execute-api.us-east-1.amazonaws.com/default/live-transcription-catchup'; // Updated with clip creation strategy
    
    // Load API keys from storage
    this.loadApiKeys().then(() => {
      this.keysLoaded = true;
    });
  }
  
  async loadApiKeys() {
    try {
      const result = await chrome.storage.local.get(['assemblyAiKey', 'openAiKey']);
      this.assemblyAiApiKey = result.assemblyAiKey;
      this.openAiApiKey = result.openAiKey;
      
      // Always use hardcoded keys from config (bypass storage issues)
      // Use hardcoded API keys from config
      this.assemblyAiApiKey = "d075180583e743dc84435b50f422373b";
      this.openAiApiKey = "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";
    } catch (error) {
      // Failed to load API keys
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
      // REMOVED console.error('Failed to save API keys:', error);
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
        // REMOVED console.log('BG_INJECT: Content scripts already available');
        return;
      }
      
      // REMOVED console.log('BG_INJECT: Content scripts not available, injecting...');
      
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
      
      // REMOVED console.log('BG_INJECT: Content scripts injected successfully');
      
      // Wait a moment for scripts to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      // REMOVED console.error('BG_INJECT: Failed to inject content scripts:', error);
      throw new Error('Failed to inject content scripts: ' + error.message);
    }
  }
  
  async startTranscription(tabId, streamId) {
    if (this.isTranscribing) {
      // REMOVED console.log('BG: Transcription already running');
      return;
    }
    
    // REMOVED console.log('BG: Starting transcription for tab:', tabId, 'with stream ID:', streamId);
    
    // Wait for API keys to be loaded
    if (!this.keysLoaded) {
      // REMOVED console.log('BG: Waiting for API keys to load...');
      await this.loadApiKeys();
      this.keysLoaded = true;
    }
    
    if (!this.assemblyAiApiKey) {
      throw new Error('AssemblyAI API key not configured');
    }
    
    try {
      // Set the current tab as transcription target
      this.currentTranscriptionTabId = tabId;
      // REMOVED console.log('BG: Set transcription target tab to:', tabId);
      
      // Step 1: Ensure content scripts are injected
      // REMOVED console.log('BG_STEP_1: Injecting content scripts...');
      await this.ensureContentScriptsInjected(tabId);
      
      // Step 2: Connect to AssemblyAI WebSocket
      // REMOVED console.log('BG_STEP_2: Connecting to AssemblyAI...');
      await this.connectToAssemblyAI();
      
      // Step 3: Set up offscreen document for audio processing (content scripts can't use tabCapture)
      // REMOVED console.log('BG_STEP_3: Setting up offscreen document with AudioWorklet...');
      await this.setupOffscreenDocument();
      
      // Step 4: Start audio capture in offscreen document with stream ID
      // REMOVED console.log('BG_STEP_4: Starting offscreen audio capture with AudioWorklet...');
      
      const captureResponse = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'START_OFFSCREEN_CAPTURE',
          streamId: streamId
        }, (response) => {
          if (chrome.runtime.lastError) {
            // REMOVED console.error('BG: Error communicating with offscreen document:', chrome.runtime.lastError);
            reject(new Error('Failed to communicate with offscreen document: ' + chrome.runtime.lastError.message));
            return;
          }
          // REMOVED console.log('BG: Received response from offscreen document:', response);
          resolve(response);
        });
      });
      
      if (!captureResponse.success) {
        throw new Error('Offscreen capture failed: ' + (captureResponse.error || 'Unknown error'));
      }
      
      // REMOVED console.log('BG: Offscreen capture started successfully');
      
      this.isTranscribing = true;
      // REMOVED console.log('✅ BG: Transcription started successfully');
      
      // Start transcript storage session
      chrome.tabs.get(tabId, (tab) => {
        if (tab && tab.url) {
          const streamTitle = tab.title || 'Unknown Stream';
          // this.transcriptStorage.startTranscriptSession(tab.url, streamTitle);
          // REMOVED console.log('📝 Started transcript storage session for:', tab.url);
        }
      });

      // Notify content script that transcription has started
      chrome.tabs.sendMessage(tabId, {
        type: 'TRANSCRIPTION_STARTED'
      }, (response) => {
        if (chrome.runtime.lastError) {
          // REMOVED console.warn('BG: Could not notify content script of transcription start:', chrome.runtime.lastError.message);
        } else {
          // REMOVED console.log('BG: Content script notified of transcription start');
        }
      });
      
    } catch (error) {
      // REMOVED console.error('BG: Failed to start transcription:', error);
      // Clean up on error
      this.stopTranscription();
      throw error;
    }
  }
  
  async connectToAssemblyAI() {
    // REMOVED console.log('WEBSOCKET_STEP_1: Connecting to AssemblyAI...');
    
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
    
    // REMOVED console.log('WEBSOCKET_STEP_2: Connecting to v3 endpoint:', wsUrl);
    
    return new Promise((resolve, reject) => {
      try {
        this.websocket = new WebSocket(wsUrl);
      } catch (error) {
        // REMOVED console.error('WEBSOCKET_ERROR: Failed to create WebSocket:', error);
        reject(error);
        return;
      }
      
      this.websocket.onopen = () => {
        // REMOVED console.log('🟢 WebSocket connected to AssemblyAI v3 streaming');
        
        // For v3 API, authentication is done via the token parameter in URL
        // No additional authentication message needed
        // REMOVED console.log('🔐 Connected with token authentication via URL parameters');
        resolve(); // Resolve immediately as connection is authenticated
      };
      
      this.websocket.onmessage = (event) => {
        // REMOVED console.log('WEBSOCKET_MESSAGE: Received from AssemblyAI:', event.data);
        const data = JSON.parse(event.data);
        const messageType = data.type;
        
        // Log all message types for debugging
        // REMOVED console.log('WEBSOCKET_MESSAGE_TYPE:', messageType, 'Full data:', data);
        
        if (messageType === "Begin") {
          // REMOVED console.log('SESSION_BEGIN:', data.session_id);
          // REMOVED console.log('🎤 READY FOR AUDIO - Session started, speak into your tab audio!');
          // Don't resolve here for v3, wait for actual transcripts
        } else if (messageType === "Turn") {
          // v3 API sends Turn messages with transcripts
          const text = data.transcript || "";
          const isFinal = data.end_of_turn || false;
          const turnOrder = data.turn_order || 0;
          
          // Only show transcript if it has meaningful content or is final
          const shouldShow = text.trim().length > 0 && (
            isFinal || 
            text.length > 3 || // Show partials only if they have substance
            data.end_of_turn_confidence > 0.1 // Or reasonable confidence
          );
          
          if (shouldShow) {
            // REMOVED console.log(`🎯 ${isFinal ? 'FINAL' : 'PARTIAL'} TRANSCRIPT (turn ${turnOrder}):`);
            // REMOVED console.log('   Text:', `"${text}"`);
            // REMOVED console.log('   Length:', text.length);
            // REMOVED console.log('   Confidence:', data.end_of_turn_confidence);
            
            // Use a smarter display strategy
            this.displayTranscriptSmooth(text, isFinal, turnOrder);
            
            // Save to full transcript if final
            if (isFinal && text.trim()) {
              this.transcript += (this.transcript ? ' ' : '') + text;
              // REMOVED console.log('💾 SAVED_TO_TRANSCRIPT:', text);
              // REMOVED console.log('📊 FULL_TRANSCRIPT_LENGTH:', this.transcript.length);
            }
            
            // Store transcript for catch-up feature
            if (text.trim()) {
              // this.transcriptStorage.addTranscript(text, isFinal);
            }
          } else {
            // Log skipped transcripts for debugging
            // REMOVED console.log(`⏭️ SKIPPED short/low-confidence transcript: "${text}" (${text.length} chars, conf: ${data.end_of_turn_confidence})`);
          }
        } else if (messageType === "End") {
          // REMOVED console.log('⏹ SESSION_END: Session terminated');
        } else {
          // REMOVED console.log('🔍 WEBSOCKET_OTHER:', messageType, data);
          
          // Check if this is an error message
          if (data.error || data.message) {
            // REMOVED console.error('🚨 ASSEMBLYAI_ERROR:', data);
          }
        }
      };
      
      // Add a test message sender
      setTimeout(() => {
        // REMOVED console.log('🧪 TEST: Forcing a test transcript display...');
        this.forceShowOverlay('Test transcript - if you see this, the overlay system works!', false);
      }, 3000);
      
      this.websocket.onerror = (error) => {
        // REMOVED console.error('🔴 WebSocket error:', error);
        reject(error);
      };
      
      this.websocket.onclose = (event) => {
        // REMOVED console.log('🔒 WebSocket closed with code:', event.code, 'reason:', event.reason);
        this.isTranscribing = false;
      };
    });
  }
  
  displayTranscriptSmooth(text, isFinal, turnOrder) {
    // Implement optimized real-time captioning
    if (!this.currentTurnOrder) this.currentTurnOrder = -1;
    if (!this.lastPartialText) this.lastPartialText = '';
    
    // Only update if this is a newer turn or significantly different content
    const isNewerTurn = turnOrder > this.currentTurnOrder;
    const isSignificantUpdate = turnOrder === this.currentTurnOrder && (
      isFinal || 
      text.length > this.lastPartialText.length + 2 || // At least 2+ new characters
      text.split(' ').length > this.lastPartialText.split(' ').length // New word
    );
    
    if (isNewerTurn || isSignificantUpdate) {
      this.currentTurnOrder = turnOrder;
      
      if (!isFinal) {
        // Optimized partial updates - only if meaningful change
        if (this.partialUpdateTimeout) {
          clearTimeout(this.partialUpdateTimeout);
        }
        
        // Reduced delay for more responsive updates
        this.partialUpdateTimeout = setTimeout(() => {
          this.sendTranscriptToTab(text, false);
          this.lastPartialText = text;
        }, 50); // Faster 50ms delay for better real-time feel
        
      } else {
        // Show final transcripts immediately
        if (this.partialUpdateTimeout) {
          clearTimeout(this.partialUpdateTimeout);
          this.partialUpdateTimeout = null;
        }
        this.sendTranscriptToTab(text, true);
        this.lastPartialText = '';
      }
    }
  }
  
  sendTranscriptToTab(text, isFinal) {
    // Send transcript to the tab being transcribed (not the active tab)
    if (this.currentTranscriptionTabId) {
      // REMOVED console.log('📤 SENDING to transcription tab:', { text, isFinal, tabId: this.currentTranscriptionTabId });
      chrome.tabs.sendMessage(this.currentTranscriptionTabId, {
        type: 'NEW_TRANSCRIPT',
        text: text,
        isFinal: isFinal
      }, (response) => {
        if (chrome.runtime.lastError) {
          // REMOVED console.error('❌ FAILED to send transcript to transcription tab:', chrome.runtime.lastError.message);
        } else {
          // REMOVED console.log('✅ SENT transcript to transcription tab:', response);
        }
      });
    } else {
      // Fallback to active tab (old behavior)
      chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
        if (tabs[0]) {
          // REMOVED console.log('📤 SENDING to active tab (fallback):', { text, isFinal, tabId: tabs[0].id });
          chrome.tabs.sendMessage(tabs[0].id, {
            type: 'NEW_TRANSCRIPT',
            text: text,
            isFinal: isFinal
          }, (response) => {
            if (chrome.runtime.lastError) {
              // REMOVED console.error('❌ FAILED to send transcript to content script:', chrome.runtime.lastError.message);
            } else {
              // REMOVED console.log('✅ SENT transcript to content script:', response);
            }
          });
        }
      });
    }
  }

  forceShowOverlay(text, isFinal) {
    // REMOVED console.log('🎨 FORCE_OVERLAY:', { text, isFinal });
    
    // First try to send to the tracked transcription tab
    if (this.currentTranscriptionTabId) {
      chrome.tabs.sendMessage(this.currentTranscriptionTabId, {
        type: 'NEW_TRANSCRIPT',
        text: text,
        isFinal: isFinal,
        forceShow: true
      }, (response) => {
        if (!chrome.runtime.lastError) {
          // REMOVED console.log(`✅ SENT transcript to tracked tab ${this.currentTranscriptionTabId}:`, response);
        } else {
          // REMOVED console.log(`❌ Failed to send to tracked tab, trying all tabs...`);
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
            // REMOVED console.log(`✅ SENT transcript to tab ${tab.id} (${tab.url || 'unknown'}):`, response);
          }
        });
      });
    });
  }
  
  
  
  async setupOffscreenDocument() {
    // REMOVED console.log('BG: Setting up offscreen document...');
    
    // Check if offscreen document already exists
    const hasDocument = await chrome.offscreen.hasDocument?.();
    // REMOVED console.log('BG: Offscreen document exists?', hasDocument);
    
    if (hasDocument) {
      // REMOVED console.log('BG: Using existing offscreen document');
      return;
    }
    
    // REMOVED console.log('BG: Creating new offscreen document...');
    
    try {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: ['USER_MEDIA'],
        justification: 'Processing tab audio for real-time transcription with AudioWorklet'
      });
      // REMOVED console.log('✅ BG: Offscreen document created successfully');
      
      // Wait a moment for offscreen document to initialize
      await new Promise(resolve => setTimeout(resolve, 500));
      
    } catch (error) {
      // REMOVED console.error('❌ BG: Failed to create offscreen document:', error);
      throw error;
    }
  }
  
  stopTranscription() {
    // REMOVED console.log('🛑 BG: Stopping all transcription services...');
    
    // Set stopping flag to prevent new operations
    this.isTranscribing = false;
    
    // Clear any pending timeouts/intervals
    if (this.partialUpdateTimeout) {
      // REMOVED console.log('⏰ BG: Clearing partial update timeout...');
      clearTimeout(this.partialUpdateTimeout);
      this.partialUpdateTimeout = null;
    }
    
    // Close WebSocket connection properly
    if (this.websocket) {
      // REMOVED console.log('🔌 BG: Closing WebSocket connection...');
      try {
        this.websocket.close(1000, 'User requested stop'); // Normal closure
        this.websocket = null;
      } catch (error) {
        // REMOVED console.warn('⚠️ BG: WebSocket close error (expected):', error.message);
        this.websocket = null;
      }
    }
    
    // Stop offscreen document processing completely
    // REMOVED console.log('📄 BG: Stopping offscreen document processing...');
    chrome.runtime.sendMessage({
      type: 'STOP_OFFSCREEN_CAPTURE'
    }).catch(error => {
      // REMOVED console.log('🔄 BG: Offscreen stop message sent (error expected):', error.message);
    });
    
    // Close and cleanup offscreen document entirely
    setTimeout(async () => {
      try {
        const hasDocument = await chrome.offscreen.hasDocument?.();
        if (hasDocument) {
          // REMOVED console.log('🗑️ BG: Closing offscreen document...');
          await chrome.offscreen.closeDocument();
          // REMOVED console.log('✅ BG: Offscreen document closed');
        }
      } catch (error) {
        // REMOVED console.log('⚠️ BG: Offscreen document cleanup (expected):', error.message);
      }
    }, 500); // Give time for stop message to process
    
    // Clean up any legacy audio processing
    if (this.audioProcessor) {
      // REMOVED console.log('🎵 BG: Disconnecting legacy audio processor...');
      try {
        this.audioProcessor.disconnect();
      } catch (error) {
        // REMOVED console.warn('⚠️ BG: Audio processor disconnect error:', error.message);
      }
      this.audioProcessor = null;
    }
    
    if (this.capturedStream) {
      // REMOVED console.log('📹 BG: Stopping captured stream tracks...');
      try {
        this.capturedStream.getTracks().forEach(track => track.stop());
      } catch (error) {
        // REMOVED console.warn('⚠️ BG: Stream track stop error:', error.message);
      }
      this.capturedStream = null;
    }
    
    if (this.mediaStream) {
      // REMOVED console.log('🎤 BG: Stopping media stream tracks...');
      try {
        this.mediaStream.getTracks().forEach(track => track.stop());
      } catch (error) {
        // REMOVED console.warn('⚠️ BG: Media stream stop error:', error.message);
      }
      this.mediaStream = null;
    }
    
    if (this.audioContext) {
      // REMOVED console.log('🔊 BG: Closing audio context...');
      try {
        this.audioContext.close();
      } catch (error) {
        // REMOVED console.warn('⚠️ BG: Audio context close error:', error.message);
      }
      this.audioContext = null;
    }
    
    // Reset all state variables completely
    this.currentTranscriptionTabId = null;
    this.audioChunkCount = 0;
    this.currentTurnOrder = -1;
    this.lastPartialText = '';
    this.keysLoaded = true; // Keep this so we don't reload keys
    
    // Send stop messages to content scripts (both overlay and audio processing)
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        // Stop transcription display
        chrome.tabs.sendMessage(tab.id, {
          type: 'TRANSCRIPTION_STOPPED'
        }, () => {
          // Ignore errors for tabs that don't have content scripts
          if (chrome.runtime.lastError) {
            // Silent ignore - many tabs won't have our content script
          }
        });
        
        // Stop any content script audio processing
        chrome.tabs.sendMessage(tab.id, {
          type: 'STOP_AUDIO_CAPTURE'
        }, () => {
          if (chrome.runtime.lastError) {
            // Silent ignore - many tabs won't have our content script
          }
        });
      });
    });
    
    // Stop transcript storage session
    // this.transcriptStorage.stopTranscriptSession();
    
    // REMOVED console.log('✅ BG: All transcription services stopped and cleaned up completely');
    
    // Force garbage collection hint (if available)
    if (typeof gc === 'function') {
      setTimeout(() => {
        try {
          gc();
          // REMOVED console.log('🗑️ BG: Garbage collection triggered');
        } catch (e) {
          // gc() might not be available
        }
      }, 1000);
    }
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
      // REMOVED console.error('Failed to get AI response:', error);
      throw error;
    }
  }
  
  // Catch-up feature methods
  async requestCatchup(streamUrl, duration) {
    console.log('🎯 BG_CATCHUP: Processing catch-up request for:', streamUrl, 'Duration:', duration + 'min');
    
    // First try stored transcript approach (faster, more reliable)
    // REMOVED console.log('📝 Checking stored transcripts first...');
    const storedResult = await this.requestCatchupFromStoredTranscripts(streamUrl, duration);
    if (storedResult.success) {
      return storedResult;
    }
    
    // REMOVED console.log('⚠️ No stored transcripts available, trying local server...');
    
    // Try local server approach
    const localResult = await this.requestCatchupFromLocalServer(streamUrl, duration);
    if (localResult.success) {
      return localResult;
    }
    
    // REMOVED console.log('⚠️ Local server unavailable, trying native messaging...');
    
    // Try native messaging for local processing
    const nativeResult = await this.requestCatchupFromNativeHost(streamUrl, duration);
    if (nativeResult.success) {
      return nativeResult;
    }
    
    // REMOVED console.log('⚠️ Native messaging unavailable, falling back to serverless VOD extraction...');
    
    try {
      // Validate inputs
      if (!streamUrl || typeof streamUrl !== 'string') {
        throw new Error('Invalid stream URL provided.');
      }
      
      if (!duration || (duration !== 30 && duration !== 60)) {
        throw new Error('Duration must be either 30 or 60 minutes.');
      }
      
      // Validate stream URL
      if (!this.isValidStreamUrl(streamUrl)) {
        throw new Error('Unsupported stream platform. Currently supports Twitch, YouTube, and Kick streams.');
      }
      
      // Send request to serverless backend API
      const response = await fetch(this.backendUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'LiveTranscriptionExtension/1.0'
        },
        body: JSON.stringify({
          stream_url: streamUrl,
          duration_minutes: duration,
          user_id: 'chrome-extension-user'
        })
      });
      
      if (!response.ok) {
        let errorMessage = `Backend API error: ${response.status}`;
        try {
          const errorData = await response.json();
          errorMessage = errorData.detail || errorData.message || errorMessage;
        } catch (parseError) {
          // If we can't parse the error, use the generic message
        }
        throw new Error(errorMessage);
      }
      
      const data = await response.json();
      
      // Check if processing was successful
      if (data.status === 'failed') {
        throw new Error(data.error || 'Serverless processing failed');
      }
      
      if (data.status === 'complete') {
        console.log('✅ BG_CATCHUP: Processing completed successfully');
        return { 
          status: 'complete', 
          result: data,
          processingTime: data.processingTime 
        };
      }
      
      // If status is not complete, something unexpected happened
      throw new Error('Unexpected response from serverless function');
      
    } catch (error) {
      console.error('❌ BG_CATCHUP: Failed to request catch-up:', error);
      throw error;
    }
  }
  
  async requestCatchupFromStoredTranscripts(streamUrl, duration) {
    /**
     * Get AI summary from stored real-time transcripts (much faster and more reliable)
     */
    try {
      console.log('📝 BG_STORED_CATCHUP: Retrieving stored transcripts...');
      
      // const summaryData = await this.transcriptStorage.getCatchupSummary(streamUrl, duration);
      const summaryData = { error: "Stored transcript catch-up temporarily disabled" };
      
      if (summaryData.error) {
        console.log('📝 BG_STORED_CATCHUP: No stored data -', summaryData.error);
        return { success: false, reason: 'no_stored_transcripts', error: summaryData.error };
      }
      
      console.log('📝 BG_STORED_CATCHUP: Found transcript data:', summaryData.transcript_segments, 'segments');
      
      // Send to OpenAI for summarization
      if (!this.openAiApiKey) {
        return { success: false, error: 'OpenAI API key not configured' };
      }
      
      const aiSummary = await this.generateAiSummaryFromTranscript(summaryData.full_transcript, summaryData);
      
      const result = {
        status: 'complete',
        result: {
          summary: aiSummary,
          fullTranscript: summaryData.full_transcript,
          transcriptSegments: summaryData.transcript_segments,
          duration: duration,
          processingTime: 0.5, // Very fast since we use stored data
          streamUrl: streamUrl,
          method: 'stored_transcripts',
          metadata: summaryData
        }
      };
      
      console.log('✅ BG_STORED_CATCHUP: Generated AI summary from stored transcripts');
      return { success: true, status: 'complete', data: result.result, processingTime: result.result.processingTime };
      
    } catch (error) {
      console.error('❌ BG_STORED_CATCHUP: Error:', error);
      return { success: false, error: error.message };
    }
  }
  
  async generateAiSummaryFromTranscript(transcript, metadata) {
    /**
     * Generate AI summary from transcript text using OpenAI
     */
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
              content: 'You are a helpful assistant that creates concise summaries of live stream transcripts. Focus on key moments, interesting discussions, and notable events. Be engaging and informative.'
            },
            {
              role: 'user',
              content: `Please summarize the last ${metadata.duration_minutes} minutes of this live stream transcript. Stream: "${metadata.stream_title}"\n\nTranscript:\n${transcript}\n\nInclude:\n1. Key highlights and interesting moments\n2. Main topics discussed\n3. Notable events or reactions\n4. Overall stream context\n\nKeep it concise but engaging.`
            }
          ],
          max_tokens: 800,
          temperature: 0.7
        })
      });
      
      if (!response.ok) {
        throw new Error(`OpenAI API error: ${response.status}`);
      }
      
      const data = await response.json();
      const aiSummary = data.choices[0].message.content;
      
      // Format the summary with metadata
      const formattedSummary = `🎮 **Live Stream Summary** (${metadata.duration_minutes} minutes)

${aiSummary}

**📊 Analysis Details:**
• Stream: ${metadata.stream_title}
• Time period: Last ${metadata.duration_minutes} minutes  
• Transcript segments: ${metadata.transcript_segments}
• Processing method: Real-time stored transcripts ⚡

**🎯 Data Source:**
• ✅ Live transcription capture (high accuracy)
• ✅ Real-time storage (instant access)
• ✅ AI summarization with GPT-4

*This summary was generated from real-time transcript data captured during live viewing. For best results, ensure live transcription is active while watching streams.*`;
      
      return formattedSummary;
      
    } catch (error) {
      // REMOVED console.error('❌ AI summary generation error:', error);
      return `**⚠️ Summary Generation Failed**

We successfully retrieved ${metadata.transcript_segments} transcript segments from the last ${metadata.duration_minutes} minutes, but failed to generate an AI summary.

**Raw Transcript Preview:**
${transcript.substring(0, 500)}...

**Error:** ${error.message}`;
    }
  }
  
  async requestCatchupFromLocalServer(streamUrl, duration) {
    /**
     * Try native messaging first (bundled with extension), then fall back to local server
     */
    try {
      console.log('📱 BG_NATIVE: Trying native messaging host...');
      
      const nativeResult = await this.requestCatchupFromNativeHost(streamUrl, duration);
      if (nativeResult.success) {
        return nativeResult;
      }
      
      console.log('🖥️ BG_LOCAL: Native messaging failed, trying local server...');
      
      const response = await fetch('http://localhost:8080/catchup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stream_url: streamUrl,
          duration_minutes: duration
        })
      });
      
      if (!response.ok) {
        console.log('🖥️ BG_LOCAL: Local server not available:', response.status);
        return { success: false, error: 'Local processing not available' };
      }
      
      const data = await response.json();
      
      if (data.status === 'complete') {
        console.log('✅ BG_LOCAL: Local processing successful');
        return { 
          success: true, 
          status: 'complete', 
          data: data,
          processingTime: data.processingTime 
        };
      } else {
        console.log('❌ BG_LOCAL: Local processing failed:', data.error);
        return { success: false, error: data.error };
      }
      
    } catch (error) {
      console.log('🖥️ BG_LOCAL: Connection failed:', error.message);
      return { success: false, error: 'Local processing connection failed' };
    }
  }

  async requestCatchupFromNativeHost(streamUrl, duration) {
    /**
     * Use Chrome Native Messaging to process catch-up request
     */
    return new Promise(async (resolve) => {
      try {
        console.log('📱 BG_NATIVE: Connecting to native host...');
        console.log('📱 BG_NATIVE: Host name: live_transcription_host');
        console.log('📱 BG_NATIVE: Chrome runtime available:', !!chrome.runtime);
        console.log('📱 BG_NATIVE: connectNative available:', !!chrome.runtime.connectNative);
        
        // First get VOD URL from serverless backend
        // REMOVED console.log('🔍 Getting VOD URL from serverless backend...');
        
        const vodResponse = await fetch(this.backendUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            stream_url: streamUrl,
            duration_minutes: duration,
            user_id: 'native-messaging-user'
          })
        });
        
        const vodData = await vodResponse.json();
        
        console.log('🔍 BG_NATIVE: Serverless response status:', vodData.status);
        console.log('🔍 BG_NATIVE: Serverless response vodUrl:', vodData.vodUrl);
        console.log('🔍 BG_NATIVE: Full serverless response:', JSON.stringify(vodData, null, 2));
        
        if (vodData.status !== 'complete' || !vodData.vodUrl) {
          throw new Error('Failed to get VOD URL from serverless backend');
        }
        
        // REMOVED console.log('✅ Got VOD URL:', vodData.vodUrl);
        
        console.log('📱 BG_NATIVE: Attempting to connect...');
        const port = chrome.runtime.connectNative('live_transcription_host');
        console.log('📱 BG_NATIVE: Connection attempt completed, port:', !!port);
        console.log('📱 BG_NATIVE: Port name:', port?.name);
        console.log('📱 BG_NATIVE: Port error:', port?.error);
        
        let result = null;
        let progressCallback = null;
        
        // Send progress updates to content script
        chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
          if (tabs[0]) {
            progressCallback = (message) => {
              chrome.tabs.sendMessage(tabs[0].id, {
                type: 'CATCHUP_PROGRESS',
                ...message
              });
            };
          }
        });
        
        port.onMessage.addListener((response) => {
          console.log('📱 BG_NATIVE: Received message type:', response.type);
          console.log('📱 BG_NATIVE: Full response:', JSON.stringify(response, null, 2));
          
          if (response.type === 'ack') {
            console.log('✅ BG_NATIVE: Native host acknowledged connection!');
          } else if (response.type === 'progress' && progressCallback) {
            console.log('📊 BG_NATIVE: Progress update:', response.data);
            progressCallback(response.data);
          } else if (response.type === 'complete') {
            result = response;
            port.disconnect();
            console.log('🎉 BG_NATIVE: Processing completed successfully!');
            console.log('📄 BG_NATIVE: Summary length:', response.data?.summary?.length || 0);
            console.log('📄 BG_NATIVE: Transcript length:', response.data?.fullTranscript?.length || 0);
            resolve({ 
              success: true, 
              status: 'complete', 
              data: response.data,
              processingTime: 'Native messaging processing'
            });
          } else if (response.type === 'error') {
            result = response;
            port.disconnect();
            console.log('❌ BG_NATIVE: Processing failed with error:', response.error);
            resolve({ success: false, error: response.error });
          } else {
            console.log('❓ BG_NATIVE: Unknown response type:', response.type);
          }
        });
        
        port.onDisconnect.addListener(() => {
          console.log('📱 BG_NATIVE: Disconnected');
          const lastError = chrome.runtime.lastError;
          console.log('📱 BG_NATIVE: Chrome lastError:', lastError);
          console.log('📱 BG_NATIVE: Error message:', lastError?.message);
          console.log('📱 BG_NATIVE: Expected manifest path: /Users/aryanwad/Library/Application Support/Google/Chrome/NativeMessagingHosts/live_transcription_host.json');
          
          if (!result) {
            const error = lastError?.message || 'Native messaging failed';
            console.log('❌ BG_NATIVE: Connection failed:', error);
            console.log('❌ BG_NATIVE: Troubleshooting:');
            console.log('   1. Check if manifest exists at expected path');
            console.log('   2. Check if wrapper script is executable');  
            console.log('   3. Check if Python dependencies are installed');
            resolve({ success: false, error: 'Native host not available - install required' });
          }
        });
        
        // Send catch-up request with VOD URL to native host
        const catchupMessage = {
          type: 'catchup',
          data: {
            vod_url: vodData.vodUrl,
            stream_url: streamUrl,
            duration_minutes: duration
          }
        };
        
        console.log('📤 BG_NATIVE: Sending catch-up request to native host:');
        console.log('📤 BG_NATIVE: VOD URL:', vodData.vodUrl);
        console.log('📤 BG_NATIVE: Stream URL:', streamUrl);
        console.log('📤 BG_NATIVE: Duration:', duration, 'minutes');
        
        port.postMessage(catchupMessage);
        
      } catch (error) {
        console.log('❌ BG_NATIVE: Exception:', error.message);
        resolve({ success: false, error: `Native messaging failed: ${error.message}` });
      }
    });
  }
  
  
  isValidStreamUrl(url) {
    const supportedPlatforms = [
      'twitch.tv',
      'youtube.com',
      'youtu.be',
      'kick.com'
    ];
    
    return supportedPlatforms.some(platform => url.includes(platform));
  }
  
  cleanupCatchupTasks() {
    // Clean up completed or old tasks (older than 10 minutes)
    const now = Date.now();
    const maxAge = 10 * 60 * 1000; // 10 minutes
    
    for (const [taskId, task] of this.catchupTasks.entries()) {
      if (task.status === 'complete' || task.status === 'failed' || (now - task.startTime) > maxAge) {
        console.log('🧹 BG_CATCHUP: Cleaning up old task:', taskId);
        this.catchupTasks.delete(taskId);
      }
    }
  }
}

// Global service instance
const transcriptionService = new TranscriptionService();

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // REMOVED console.log('BG: Received message:', request.type, 'from:', sender.tab?.id || 'popup');
  
  switch (request.type) {
    case 'START_TRANSCRIPTION':
      // REMOVED console.log('BG: 🚀 START_TRANSCRIPTION received with streamId:', request.streamId, 'tabId:', request.tabId);
      (async () => {
        try {
          await transcriptionService.startTranscription(request.tabId, request.streamId);
          // REMOVED console.log('BG: ✅ Transcription started successfully, sending success response');
          sendResponse({success: true});
        } catch (error) {
          // REMOVED console.error('BG: ❌ Transcription start failed:', error);
          sendResponse({success: false, error: error.message});
        }
      })();
      return true; // Keep message channel open for async response
      
    case 'STOP_TRANSCRIPTION':
      // REMOVED console.log('📨 STOP_TRANSCRIPTION message received from:', sender.tab?.id || 'popup');
      
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
      
    case 'REQUEST_CATCHUP':
      console.log('📨 REQUEST_CATCHUP message received:', request.streamUrl, request.duration + 'min');
      (async () => {
        try {
          const result = await transcriptionService.requestCatchup(request.streamUrl, request.duration);
          // REMOVED console.log('✅ BG: Catch-up request successful:', result);
          sendResponse({success: true, status: 'complete', data: result.data || result.result, processingTime: result.processingTime});
        } catch (error) {
          // REMOVED console.error('❌ BG: Catch-up request failed:', error);
          sendResponse({success: false, error: error.message});
        }
      })();
      return true; // Keep message channel open for async response
      
    case 'AUDIO_DATA_FROM_OFFSCREEN':
      // Forward audio data from offscreen document (AudioWorklet) to AssemblyAI WebSocket
      // But only if transcription is still active
      if (!transcriptionService.isTranscribing) {
        // Silently drop audio data if transcription is stopped
        sendResponse({success: false, reason: 'transcription_stopped'});
        break;
      }
      
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
              // Audio logging removed
            }
          } else if (transcriptionService.audioChunkCount % 100 === 0) { // Log every 100th silent chunk
            // REMOVED console.log('🔇 BG_AUDIO: Silent chunk sent - total chunks:', transcriptionService.audioChunkCount);
          }
          
        } catch (error) {
          // REMOVED console.error('❌ BG_AUDIO: Error processing audio data:', error);
        }
      } else {
        // Don't log warnings if transcription is intentionally stopped
        if (transcriptionService.isTranscribing) {
          // Audio warning removed
        }
      }
      sendResponse({success: transcriptionService.isTranscribing});
      break;
      
      
      
    case 'SET_TRANSCRIPTION_SOURCE':
      // REMOVED console.log('📍 SET_TRANSCRIPTION_SOURCE:', request.sourceInfo);
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
          // REMOVED console.log('🎯 SET transcription target tab:', mediaTabs[0].id, 'URL:', mediaTabs[0].url);
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
// REMOVED console.log('🎤 BG: Live Transcription Assistant background service loaded at:', new Date().toISOString());

// Handle service worker errors
self.addEventListener('error', (event) => {
  // REMOVED console.error('BG: Service worker error:', event.error);
});

self.addEventListener('unhandledrejection', (event) => {
  // REMOVED console.error('BG: Unhandled promise rejection:', event.reason);
});