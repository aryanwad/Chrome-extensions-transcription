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
      
      // Check if current tab has audio
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      const currentTab = tabs[0];
      
      if (!currentTab || currentTab.url.startsWith('chrome://')) {
        this.showStatus('Please navigate to a webpage with audio/video content', 'warning');
        return;
      }
      
      // Send start transcription message
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'START_TRANSCRIPTION'
        }, resolve);
      });
      
      if (response.success) {
        this.isTranscribing = true;
        this.updateUIForTranscription(true);
        this.showStatus('Transcription started! Captions will appear on the page.', 'success');
      } else {
        this.showStatus(`Failed to start transcription: ${response.error}`, 'error');
      }
    } catch (error) {
      console.error('Error starting transcription:', error);
      this.showStatus('Error starting transcription', 'error');
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