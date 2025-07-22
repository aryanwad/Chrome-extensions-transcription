// Content script for Live Transcription Assistant overlay
class TranscriptionOverlay {
  constructor() {
    this.isVisible = false;
    this.currentText = '';
    this.overlayContainer = null;
    this.captionBox = null;
    this.agentButton = null;
    this.agentDialog = null;
    this.isTranscribing = false;
    
    this.init();
  }
  
  init() {
    // Don't inject on extension pages or chrome pages
    if (window.location.protocol === 'chrome-extension:' || 
        window.location.protocol === 'chrome:' ||
        window.location.hostname === 'chrome.google.com') {
      console.log('❌ CONTENT: Skipping overlay init on:', window.location.href);
      return;
    }
    
    // Clean up any existing overlays from previous extension runs
    this.cleanupExistingOverlays();
    
    this.createOverlay();
    this.setupMessageListener();
    
    // IMPORTANT: Hide overlay by default - only show when transcription is active
    this.forceHide();
    
    console.log('🎤 CONTENT: Live Transcription overlay initialized on:', window.location.href);
    console.log('🔒 CONTENT: Overlay hidden by default - will show only during active transcription');
  }
  
  cleanupExistingOverlays() {
    // More comprehensive cleanup - remove ALL possible overlay elements
    const overlaySelectors = [
      '#live-transcription-overlay',
      '.lt-overlay-container', 
      '.lt-agent-dialog',
      '[id*="live-transcription"]',
      '[class*="lt-"]',
      '[class*="transcription"]'
    ];
    
    let removedCount = 0;
    overlaySelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        console.log('🗑️ CLEANUP: Removing element:', element.id || element.className || element.tagName);
        element.remove();
        removedCount++;
      });
    });
    
    // Remove any existing CSS animations and styles
    const existingStyles = document.querySelectorAll('#lt-animations, style[id*="lt-"], style[id*="transcription"]');
    existingStyles.forEach(style => {
      style.remove();
      console.log('🗑️ CLEANUP: Removed style element:', style.id);
      removedCount++;
    });
    
    if (removedCount > 0) {
      console.log(`🧹 CLEANUP: Removed ${removedCount} overlay elements and styles`);
    } else {
      console.log('✅ CLEANUP: No existing overlays found');
    }
  }
  
  createOverlay() {
    // Create caption container (bottom center)
    this.captionContainer = document.createElement('div');
    this.captionContainer.id = 'live-transcription-captions';
    this.captionContainer.className = 'lt-caption-container';
    
    // Create caption box
    this.captionBox = document.createElement('div');
    this.captionBox.className = 'lt-caption-box';
    this.captionBox.innerHTML = `
      <div class="lt-caption-text"></div>
      <div class="lt-caption-status"></div>
    `;
    
    this.captionContainer.appendChild(this.captionBox);
    
    // Create controls container (top right)
    this.controlsContainer = document.createElement('div');
    this.controlsContainer.id = 'live-transcription-controls';
    this.controlsContainer.className = 'lt-controls-container';
    
    // Create Ask Agent button
    this.agentButton = document.createElement('button');
    this.agentButton.className = 'lt-agent-button';
    this.agentButton.innerHTML = '🤖 Ask Agent';
    this.agentButton.onclick = () => this.showAgentDialog();
    
    // Create Stop button
    this.stopButton = document.createElement('button');
    this.stopButton.className = 'lt-stop-button';
    this.stopButton.innerHTML = '🛑 Stop';
    this.stopButton.onclick = () => this.stopTranscription();
    this.stopButton.style.display = 'none'; // Initially hidden
    
    // Create button container
    const buttonContainer = document.createElement('div');
    buttonContainer.className = 'lt-button-container';
    buttonContainer.appendChild(this.agentButton);
    buttonContainer.appendChild(this.stopButton);
    
    this.controlsContainer.appendChild(buttonContainer);
    
    // Inject both containers into page
    document.body.appendChild(this.captionContainer);
    document.body.appendChild(this.controlsContainer);
    
    // Start completely hidden
    this.captionContainer.style.display = 'none';
    this.controlsContainer.style.display = 'none';
    this.isVisible = false;
    
    // Keep reference to the old overlayContainer for compatibility
    this.overlayContainer = this.captionContainer;
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('🎭 CONTENT SCRIPT received message:', request);
      
      switch (request.type) {
        case 'TRANSCRIPTION_STARTED':
          console.log('🟢 CONTENT: TRANSCRIPTION_STARTED - showing overlay');
          this.isTranscribing = true;
          this.show();
          this.showStopButton();
          this.updateCaption('🟢 Live transcription active...', false);
          console.log('✅ CONTENT: Overlay shown for active transcription');
          break;
          
        case 'TRANSCRIPTION_STATUS':
          console.log('📊 TRANSCRIPTION_STATUS:', request.isRunning);
          this.isTranscribing = request.isRunning;
          if (request.isRunning) {
            this.show();
            this.showStopButton();
          } else {
            this.hide();
            this.hideStopButton();
          }
          break;
          
        case 'NEW_TRANSCRIPT':
          console.log('🎯 NEW_TRANSCRIPT received:');
          console.log('   Text:', `"${request.text}"`);
          console.log('   isFinal:', request.isFinal);
          console.log('   forceShow:', request.forceShow);
          
          // Always show overlay when we get transcript
          this.show();
          
          if (request.isFinal) {
            console.log('💚 Displaying FINAL transcript:', request.text);
            this.updateCaption(request.text, true);
          } else {
            console.log('💛 Displaying PARTIAL transcript:', request.text);
            this.updateCaption(request.text, false);
          }
          break;
          
        case 'TRANSCRIPTION_STOPPED':
          console.log('🔴 CONTENT: TRANSCRIPTION_STOPPED');
          this.isTranscribing = false;
          this.hideStopButton();
          this.updateCaption('🔴 Transcription stopped', false);
          // Hide overlay after showing stop message briefly
          setTimeout(() => {
            this.forceHide();
            console.log('🔒 CONTENT: Overlay hidden after transcription stopped');
          }, 2000);
          break;
          
        case 'AUDIO_CAPTURE_ERROR':
          console.log('❌ AUDIO_CAPTURE_ERROR:', request.error);
          this.isTranscribing = false;
          this.updateCaption('❌ ' + request.error, false);
          if (request.error.includes('Share audio')) {
            setTimeout(() => {
              this.updateCaption('💡 Tip: Check "Share audio" when Chrome asks what to share', false);
            }, 3000);
          }
          break;
          
        case 'PING':
          console.log('🏓 PING received');
          break;
      }
      
      console.log('📤 Content script responding with success');
      sendResponse({success: true, received: request.type});
    });
  }
  
  updateCaption(text, isFinal) {
    console.log('🎨 UPDATE_CAPTION called:', { text, isFinal, hasBox: !!this.captionBox });
    
    if (!this.captionBox) {
      console.error('❌ captionBox is null! Cannot update caption');
      return;
    }
    
    const captionText = this.captionBox.querySelector('.lt-caption-text');
    const captionStatus = this.captionBox.querySelector('.lt-caption-status');
    
    if (!captionText || !captionStatus) {
      console.error('❌ Caption elements not found:', { captionText: !!captionText, captionStatus: !!captionStatus });
      return;
    }
    
    if (text && text.trim()) {
      console.log('✏️ Updating caption with text:', text);
      
      // Clean caption updates with consistent white text
      if (isFinal) {
        console.log('💚 Rendering FINAL transcript');
        // Final transcript - clean white text
        captionText.innerHTML = `<span class="lt-final-text">${this.escapeHtml(text)}</span>`;
        captionStatus.textContent = '';
        captionStatus.className = 'lt-caption-status final';
        this.currentText = text;
        
        // Keep consistent styling
        captionText.style.color = 'white';
        captionText.style.opacity = '1';
        captionText.style.transition = 'none';
        
        // Auto-fade final transcript after a few seconds
        setTimeout(() => {
          if (captionText.textContent === text) {
            captionText.style.opacity = '0.7';
          }
        }, 4000);
        
      } else {
        console.log('💛 Rendering PARTIAL transcript');
        // Partial transcript - clean white text
        captionText.innerHTML = `<span class="lt-partial-text">${this.escapeHtml(text)}</span>`;
        captionStatus.textContent = '';
        captionStatus.className = 'lt-caption-status partial';
        
        // Keep consistent styling
        captionText.style.color = 'white';
        captionText.style.opacity = '1';
        captionText.style.transition = 'none';
      }
      
      // No need to resize - captions are bottom-centered and auto-width
      
      console.log('✅ Caption updated successfully');
    } else {
      console.warn('⚠️ Empty or whitespace-only text provided:', `"${text}"`);
    }
  }
  
  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  resizeOverlay() {
    if (!this.overlayContainer || !this.captionBox) return;
    
    // Let content determine width, but with limits
    const textContent = this.captionBox.querySelector('.lt-caption-text');
    if (textContent) {
      // Reset width to measure natural width
      this.overlayContainer.style.width = 'auto';
      this.overlayContainer.style.maxWidth = '80vw';
      this.overlayContainer.style.minWidth = '300px';
      
      // Position based on text length
      const textLength = textContent.textContent.length;
      if (textLength > 100) {
        // Long text - position at bottom center
        this.overlayContainer.style.top = 'auto';
        this.overlayContainer.style.bottom = '20px';
        this.overlayContainer.style.left = '50%';
        this.overlayContainer.style.right = 'auto';
        this.overlayContainer.style.transform = 'translateX(-50%)';
        this.overlayContainer.style.maxWidth = '90vw';
      } else {
        // Short text - top right
        this.overlayContainer.style.top = '20px';
        this.overlayContainer.style.bottom = 'auto';
        this.overlayContainer.style.right = '20px';
        this.overlayContainer.style.left = 'auto';
        this.overlayContainer.style.transform = 'none';
      }
    }
  }
  
  show() {
    console.log('🎨 SHOW() called, containers exist:', !!this.captionContainer, !!this.controlsContainer);
    
    // Style caption container (bottom center)
    if (this.captionContainer) {
      this.captionContainer.style.cssText = `
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        z-index: 2147483647 !important;
        position: fixed !important;
        bottom: 80px !important;
        left: 50% !important;
        transform: translateX(-50%) !important;
        width: auto !important;
        max-width: 90vw !important;
        min-width: auto !important;
        background: rgba(0, 0, 0, 0.85) !important;
        color: white !important;
        padding: 8px 12px !important;
        border-radius: 6px !important;
        font-family: 'Segoe UI', Arial, sans-serif !important;
        font-size: 26px !important;
        line-height: 1.3 !important;
        text-align: center !important;
        pointer-events: none !important;
        border: none !important;
        box-shadow: none !important;
      `;
    }
    
    // Style controls container (top right)  
    if (this.controlsContainer) {
      this.controlsContainer.style.cssText = `
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        z-index: 2147483647 !important;
        position: fixed !important;
        top: 20px !important;
        right: 20px !important;
        background: linear-gradient(135deg, rgba(0, 0, 0, 0.95), rgba(20, 20, 40, 0.95)) !important;
        padding: 12px !important;
        border-radius: 8px !important;
        border: 1px solid rgba(255, 255, 255, 0.1) !important;
        backdrop-filter: blur(10px) !important;
        pointer-events: auto !important;
        box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4) !important;
        gap: 8px !important;
      `;
    }
    
    // Add CSS for clean styling if not already added
    if (!document.getElementById('lt-animations')) {
      const style = document.createElement('style');
      style.id = 'lt-animations';
      style.textContent = `
        .lt-final-text {
          color: white !important;
          font-weight: 400 !important;
        }
        
        .lt-partial-text {
          color: white !important;
          font-weight: 400 !important;
        }
        
        .lt-caption-status.final {
          display: none !important;
        }
        
        .lt-caption-status.partial {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    }
    
    // Style caption elements
    if (this.captionBox) {
      this.captionBox.style.cssText = `
        display: block !important;
        visibility: visible !important;
        opacity: 1 !important;
        color: white !important;
        background: none !important;
        border: none !important;
        box-shadow: none !important;
        margin: 0 !important;
        padding: 0 !important;
      `;
    }
    
    // Style buttons
    if (this.agentButton) {
      this.agentButton.style.cssText = `
        background: #4CAF50 !important;
        color: white !important;
        border: none !important;
        padding: 8px 12px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-size: 12px !important;
        transition: background-color 0.2s !important;
      `;
    }
    
    if (this.stopButton) {
      this.stopButton.style.cssText = `
        ${this.isTranscribing ? 'display: inline-block' : 'display: none'} !important;
        background: #f44336 !important;
        color: white !important;
        border: none !important;
        padding: 8px 12px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-size: 12px !important;
        transition: background-color 0.2s !important;
        margin-left: 8px !important;
      `;
    }
    
    this.isVisible = true;
    console.log('DEBUG_OVERLAY: Both containers shown - captions at bottom, controls at top right');
  }
  
  hide() {
    if (this.captionContainer) {
      this.captionContainer.style.cssText = `
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      `;
    }
    if (this.controlsContainer) {
      this.controlsContainer.style.cssText = `
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
      `;
    }
    this.isVisible = false;
    console.log('🔒 CONTENT: Both overlay containers hidden');
  }
  
  forceHide() {
    // Force hide both containers and ensure they stay hidden until explicitly shown
    if (this.captionContainer) {
      this.captionContainer.style.cssText = `
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        position: fixed !important;
        z-index: -1 !important;
      `;
    }
    if (this.controlsContainer) {
      this.controlsContainer.style.cssText = `
        display: none !important;
        visibility: hidden !important;
        opacity: 0 !important;
        pointer-events: none !important;
        position: fixed !important;
        z-index: -1 !important;
      `;
    }
    this.isVisible = false;
    console.log('🔒 CONTENT: Both containers force hidden - will only show during active transcription');
  }
  
  showStopButton() {
    if (this.stopButton) {
      this.stopButton.style.display = 'block';
      console.log('✅ Stop button shown');
    }
  }
  
  hideStopButton() {
    if (this.stopButton) {
      this.stopButton.style.display = 'none';
      console.log('🔒 Stop button hidden');
    }
  }
  
  async stopTranscription() {
    console.log('🛑 CONTENT: Stop transcription button clicked');
    
    try {
      // Immediately update UI to show stopping state
      this.updateCaption('🛑 Stopping transcription...', false);
      
      // Send stop message to background script
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'STOP_TRANSCRIPTION'
        }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('🛑 CONTENT: Runtime error stopping transcription:', chrome.runtime.lastError);
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      console.log('🛑 CONTENT: Stop transcription response:', response);
      
      if (response && response.success) {
        this.isTranscribing = false;
        this.hideStopButton();
        this.updateCaption('🛑 Transcription stopped successfully', false);
        
        // Hide overlay after showing success message
        setTimeout(() => {
          this.forceHide();
          console.log('🔒 CONTENT: Overlay hidden after user-initiated stop');
        }, 1500);
      } else {
        console.error('❌ CONTENT: Failed to stop transcription:', response?.error || 'Unknown error');
        this.updateCaption('❌ Failed to stop transcription', false);
        
        // Still hide the overlay after error message
        setTimeout(() => {
          this.forceHide();
        }, 3000);
      }
      
    } catch (error) {
      console.error('❌ CONTENT: Error stopping transcription:', error);
      this.updateCaption('❌ Error stopping transcription: ' + error.message, false);
      
      // Force stop local state and hide overlay
      this.isTranscribing = false;
      this.hideStopButton();
      setTimeout(() => {
        this.forceHide();
      }, 3000);
    }
  }
  
  showAgentDialog() {
    if (this.agentDialog) {
      this.agentDialog.remove();
    }
    
    // Create agent dialog
    this.agentDialog = document.createElement('div');
    this.agentDialog.className = 'lt-agent-dialog';
    this.agentDialog.innerHTML = `
      <div class="lt-agent-content">
        <div class="lt-agent-header">
          <h3>🤖 Ask Agent</h3>
          <button class="lt-close-btn" onclick="this.closest('.lt-agent-dialog').remove()">×</button>
        </div>
        <div class="lt-agent-body">
          <div class="lt-question-section">
            <label>Ask a question about the transcript:</label>
            <input type="text" class="lt-question-input" placeholder="What was discussed about...?" />
            <button class="lt-ask-btn">Ask</button>
          </div>
          <div class="lt-response-section">
            <label>AI Response:</label>
            <div class="lt-response-text">Ask a question to get started...</div>
          </div>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.agentDialog);
    
    // Setup event listeners
    const questionInput = this.agentDialog.querySelector('.lt-question-input');
    const askBtn = this.agentDialog.querySelector('.lt-ask-btn');
    const responseText = this.agentDialog.querySelector('.lt-response-text');
    
    const askQuestion = async () => {
      const question = questionInput.value.trim();
      if (!question) return;
      
      askBtn.disabled = true;
      askBtn.textContent = 'Thinking...';
      responseText.textContent = 'Processing your question...';
      
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'ASK_AI_QUESTION',
            question: question
          }, (response) => {
            if (response.success) {
              resolve(response.answer);
            } else {
              reject(new Error(response.error));
            }
          });
        });
        
        responseText.textContent = response;
      } catch (error) {
        responseText.textContent = `Error: ${error.message}`;
      } finally {
        askBtn.disabled = false;
        askBtn.textContent = 'Ask';
      }
    };
    
    askBtn.onclick = askQuestion;
    questionInput.onkeypress = (e) => {
      if (e.key === 'Enter') {
        askQuestion();
      }
    };
    
    // Focus on input
    questionInput.focus();
  }
  
  // Handle page navigation
  destroy() {
    console.log('🗑️ DESTROY: Cleaning up transcription overlay...');
    
    if (this.captionContainer) {
      this.captionContainer.remove();
      console.log('🗑️ Removed caption container');
    }
    if (this.controlsContainer) {
      this.controlsContainer.remove();
      console.log('🗑️ Removed controls container');
    }
    if (this.overlayContainer && this.overlayContainer !== this.captionContainer) {
      this.overlayContainer.remove();
      console.log('🗑️ Removed legacy overlay container');
    }
    if (this.agentDialog) {
      this.agentDialog.remove();
      console.log('🗑️ Removed agent dialog');
    }
    
    // Clean up any remaining elements
    this.cleanupExistingOverlays();
    
    console.log('✅ DESTROY: Cleanup complete');
  }
  
  // Static method to clean up all overlays (can be called from console)
  static cleanupAllOverlays() {
    console.log('🧹 STATIC CLEANUP: Removing all Live Transcription overlays...');
    
    const allOverlays = document.querySelectorAll('#live-transcription-overlay, .lt-overlay-container, .lt-agent-dialog, [id*="live-transcription"], [class*="lt-"]');
    console.log('🔍 Found', allOverlays.length, 'overlay elements to remove');
    
    allOverlays.forEach((element, index) => {
      console.log(`🗑️ Removing element ${index + 1}:`, element.id || element.className || element.tagName);
      element.remove();
    });
    
    // Remove animation styles
    const styles = document.querySelectorAll('#lt-animations, [id*="lt-"], style[id*="transcription"]');
    styles.forEach(style => {
      console.log('🗑️ Removing style:', style.id);
      style.remove();
    });
    
    console.log('✅ STATIC CLEANUP: All overlays removed');
    return `Removed ${allOverlays.length} overlay elements and ${styles.length} style elements`;
  }
}

// Make cleanup function globally available for console access
window.cleanupLiveTranscriptionOverlays = TranscriptionOverlay.cleanupAllOverlays;

// Initialize overlay when DOM is ready
let transcriptionOverlay;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    transcriptionOverlay = new TranscriptionOverlay();
    window.transcriptionOverlay = transcriptionOverlay;
  });
} else {
  transcriptionOverlay = new TranscriptionOverlay();
  window.transcriptionOverlay = transcriptionOverlay;
}

// Handle page navigation
window.addEventListener('beforeunload', () => {
  if (window.transcriptionOverlay) {
    window.transcriptionOverlay.destroy();
  }
});

console.log('🎤 Live Transcription content script loaded (overlay will remain hidden until transcription starts)');
console.log('💡 TIP: To manually clean up overlays, run: cleanupLiveTranscriptionOverlays() in console');