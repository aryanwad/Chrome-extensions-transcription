// Popup script for Live Transcription Assistant
class PopupController {
  constructor() {
    this.elements = {
      assemblyaiKey: document.getElementById('assemblyai-key'),
      openaiKey: document.getElementById('openai-key'),
      saveKeys: document.getElementById('save-keys'),
      startTranscription: document.getElementById('start-transcription'),
      stopTranscription: document.getElementById('stop-transcription'),
      statusDisplay: document.getElementById('status-display')
    };
    
    this.isTranscribing = false;
    this.init();
  }
  
  init() {
    this.loadApiKeys();
    this.setupEventListeners();
    this.checkTranscriptionStatus();
  }
  
  async loadApiKeys() {
    try {
      const result = await chrome.storage.local.get(['assemblyAiKey', 'openAiKey']);
      
      if (result.assemblyAiKey) {
        this.elements.assemblyaiKey.value = result.assemblyAiKey;
      }
      if (result.openAiKey) {
        this.elements.openaiKey.value = result.openAiKey;
      }
    } catch (error) {
      console.error('Failed to load API keys:', error);
    }
  }
  
  setupEventListeners() {
    // Save API keys
    this.elements.saveKeys.addEventListener('click', () => {
      this.saveApiKeys();
    });
    
    // Start transcription
    this.elements.startTranscription.addEventListener('click', () => {
      this.startTranscription();
    });
    
    // Stop transcription
    this.elements.stopTranscription.addEventListener('click', () => {
      this.stopTranscription();
    });
    
    // External links
    document.querySelectorAll('.link[data-url]').forEach(link => {
      link.addEventListener('click', (e) => {
        chrome.tabs.create({ url: e.target.dataset.url });
      });
    });
    
    // Enter key support
    this.elements.assemblyaiKey.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.saveApiKeys();
      }
    });
    
    this.elements.openaiKey.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.saveApiKeys();
      }
    });
  }
  
  async saveApiKeys() {
    const assemblyAiKey = this.elements.assemblyaiKey.value.trim();
    const openAiKey = this.elements.openaiKey.value.trim();
    
    if (!assemblyAiKey || !openAiKey) {
      this.showStatus('Please enter both API keys', 'error');
      return;
    }
    
    try {
      // Show loading state
      this.elements.saveKeys.disabled = true;
      this.elements.saveKeys.innerHTML = '<span class="loading"></span>Saving...';
      
      // Send to background script
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'SAVE_API_KEYS',
          assemblyAiKey: assemblyAiKey,
          openAiKey: openAiKey
        }, resolve);
      });
      
      if (response.success) {
        this.showStatus('API keys saved successfully!', 'success');
      } else {
        this.showStatus('Failed to save API keys', 'error');
      }
    } catch (error) {
      console.error('Error saving API keys:', error);
      this.showStatus('Error saving API keys', 'error');
    } finally {
      this.elements.saveKeys.disabled = false;
      this.elements.saveKeys.textContent = 'Save API Keys';
    }
  }
  
  async startTranscription() {
    // Validate API keys first
    const assemblyAiKey = this.elements.assemblyaiKey.value.trim();
    const openAiKey = this.elements.openaiKey.value.trim();
    
    if (!assemblyAiKey || !openAiKey) {
      this.showStatus('Please enter and save your API keys first', 'error');
      return;
    }
    
    try {
      // Show loading state
      this.elements.startTranscription.disabled = true;
      this.elements.startTranscription.innerHTML = '<span class="loading"></span>Starting...';
      
      // Check if current tab is valid for transcription
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      const currentTab = tabs[0];
      
      if (!currentTab || currentTab.url.startsWith('chrome://')) {
        this.showStatus('Please navigate to a webpage with audio/video content', 'warning');
        return;
      }
      
      // Show helpful message for media tabs
      const isMediaTab = currentTab.url.includes('youtube.com') || 
                        currentTab.url.includes('netflix.com') ||
                        currentTab.url.includes('twitch.tv') ||
                        currentTab.url.includes('vimeo.com') ||
                        currentTab.audible;
      
      if (isMediaTab) {
        this.showStatus('🎵 Ready to transcribe this media tab!', 'info');
      } else {
        this.showStatus('📄 Ready to transcribe this tab (make sure it has audio)', 'info');
      }
      
      // Test if content script is available
      console.log('POPUP: Testing content script availability...');
      const pingResponse = await new Promise((resolve) => {
        chrome.tabs.sendMessage(currentTab.id, { type: 'PING' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('POPUP: Content script PING failed:', chrome.runtime.lastError);
            resolve(null);
          } else {
            console.log('POPUP: Content script PING successful:', response);
            resolve(response);
          }
        });
      });
      
      if (!pingResponse) {
        console.warn('POPUP: Content script not responding, may need injection...');
        // Try to inject content scripts manually
        try {
          await chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            files: ['content.js', 'content-audio.js']
          });
          await chrome.scripting.insertCSS({
            target: { tabId: currentTab.id },
            files: ['overlay.css']
          });
          console.log('POPUP: Content scripts injected manually');
          
          // Wait a moment for scripts to initialize
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (injectionError) {
          console.error('POPUP: Failed to inject content scripts:', injectionError);
          throw new Error('Content scripts could not be loaded: ' + injectionError.message);
        }
      }
      
      // Get tab capture stream ID in popup context (required for user interaction)
      console.log('POPUP: Getting tab capture stream ID for tab:', currentTab.id);
      
      let streamId;
      try {
        streamId = await new Promise((resolve, reject) => {
          // Check if chrome.tabCapture is available
          if (!chrome.tabCapture || !chrome.tabCapture.getMediaStreamId) {
            reject(new Error('Chrome Tab Capture API not available. Please update Chrome to version 116 or later.'));
            return;
          }

          console.log('POPUP: Requesting stream ID with getMediaStreamId...');
          chrome.tabCapture.getMediaStreamId({
            targetTabId: currentTab.id
          }, (streamId) => {
            if (chrome.runtime.lastError) {
              console.error('POPUP: getMediaStreamId error:', chrome.runtime.lastError);
              
              // Provide user-friendly error messages
              let errorMessage = chrome.runtime.lastError.message;
              if (errorMessage.includes('Permission dismissed')) {
                errorMessage = 'Permission was dismissed. Please click the extension button again and allow tab capture when prompted.';
              } else if (errorMessage.includes('tab is not audible')) {
                errorMessage = 'This tab is not playing audio. Please navigate to a page with audio content (like YouTube, Netflix, etc.) and try again.';
              } else if (errorMessage.includes('Invalid tab')) {
                errorMessage = 'Cannot capture this tab. Please try on a regular webpage with audio content.';
              }
              
              reject(new Error(errorMessage));
              return;
            }
            
            if (!streamId) {
              reject(new Error('No stream ID received from Chrome. Please ensure the tab has audio content and try again.'));
              return;
            }
            
            console.log('POPUP: Successfully got stream ID:', streamId);
            resolve(streamId);
          });
        });
      } catch (error) {
        console.error('POPUP: Stream ID error:', error);
        this.showStatus(error.message, 'error');
        this.elements.startTranscription.disabled = false;
        this.elements.startTranscription.textContent = 'Start Transcription';
        return;
      }

      // Send start transcription message with stream ID (back to original approach)
      console.log('POPUP: Sending transcription start request with stream ID...');
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'START_TRANSCRIPTION',
          streamId: streamId,
          tabId: currentTab.id
        }, resolve);
      });
      
      console.log('POPUP: Background response:', response);
      
      if (response && response.success) {
        this.isTranscribing = true;
        this.updateUIForTranscription(true);
        this.showStatus('🎤 Transcription started! Audio will be restored shortly...', 'success');
        console.log('POPUP: ✅ Transcription started successfully');
        
        // Show helpful info about audio behavior
        setTimeout(() => {
          this.showStatus('📺 Live captions active! Audio should now be playing normally.', 'info');
        }, 2000);
      } else {
        const errorMsg = response?.error || 'Unknown error occurred';
        console.error('POPUP: ❌ Transcription failed:', errorMsg);
        this.showStatus(`Failed to start transcription: ${errorMsg}`, 'error');
      }
    } catch (error) {
      console.error('Error starting transcription:', error);
      this.showStatus('Error starting transcription: ' + error.message, 'error');
    } finally {
      this.elements.startTranscription.disabled = false;
      this.elements.startTranscription.textContent = 'Start Transcription';
    }
  }
  
  async stopTranscription() {
    try {
      // Show loading state
      this.elements.stopTranscription.disabled = true;
      this.elements.stopTranscription.innerHTML = '<span class="loading"></span>Stopping...';
      
      // Send stop transcription message
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'STOP_TRANSCRIPTION'
        }, resolve);
      });
      
      if (response.success) {
        this.isTranscribing = false;
        this.updateUIForTranscription(false);
        this.showStatus('Transcription stopped', 'success');
      } else {
        this.showStatus('Failed to stop transcription', 'error');
      }
    } catch (error) {
      console.error('Error stopping transcription:', error);
      this.showStatus('Error stopping transcription', 'error');
    } finally {
      this.elements.stopTranscription.disabled = false;
      this.elements.stopTranscription.textContent = 'Stop Transcription';
    }
  }
  
  updateUIForTranscription(isTranscribing) {
    if (isTranscribing) {
      this.elements.startTranscription.classList.add('hidden');
      this.elements.stopTranscription.classList.remove('hidden');
    } else {
      this.elements.startTranscription.classList.remove('hidden');
      this.elements.stopTranscription.classList.add('hidden');
    }
  }
  
  showStatus(message, type) {
    this.elements.statusDisplay.textContent = message;
    this.elements.statusDisplay.className = `status ${type}`;
    this.elements.statusDisplay.classList.remove('hidden');
    
    // Auto-hide after 5 seconds
    setTimeout(() => {
      this.elements.statusDisplay.classList.add('hidden');
    }, 5000);
  }
  
  checkTranscriptionStatus() {
    // Check if transcription is already running
    chrome.runtime.sendMessage({
      type: 'GET_TRANSCRIPTION_STATUS'
    }, (response) => {
      if (response && response.isTranscribing) {
        this.isTranscribing = true;
        this.updateUIForTranscription(true);
        this.showStatus('Transcription is running', 'success');
      }
    });
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});

console.log('🎤 Live Transcription popup loaded');