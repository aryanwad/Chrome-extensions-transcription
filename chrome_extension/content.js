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
      console.log('❌ SKIPPING overlay init on:', window.location.href);
      return;
    }
    
    this.createOverlay();
    this.setupMessageListener();
    console.log('🎤 Live Transcription overlay initialized on:', window.location.href);
    
    // Test the overlay immediately
    setTimeout(() => {
      console.log('🧪 TESTING overlay display...');
      this.show();
      this.updateCaption('🧪 Test: Overlay system is working!', false);
    }, 2000);
  }
  
  createOverlay() {
    // Create main overlay container
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.id = 'live-transcription-overlay';
    this.overlayContainer.className = 'lt-overlay-container';
    
    // Create caption box
    this.captionBox = document.createElement('div');
    this.captionBox.className = 'lt-caption-box';
    this.captionBox.innerHTML = `
      <div class="lt-caption-text">Live Transcription Ready</div>
      <div class="lt-caption-status">Click the extension icon to start</div>
    `;
    
    // Create Ask Agent button
    this.agentButton = document.createElement('button');
    this.agentButton.className = 'lt-agent-button';
    this.agentButton.innerHTML = '🤖 Ask Agent';
    this.agentButton.onclick = () => this.showAgentDialog();
    
    // Add elements to container
    this.overlayContainer.appendChild(this.captionBox);
    this.overlayContainer.appendChild(this.agentButton);
    
    // Inject into page
    document.body.appendChild(this.overlayContainer);
    
    // Initially hidden
    this.hide();
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('🎭 CONTENT SCRIPT received message:', request);
      
      switch (request.type) {
        case 'TRANSCRIPTION_STARTED':
          console.log('🟢 TRANSCRIPTION_STARTED - showing overlay');
          this.isTranscribing = true;
          this.show();
          this.updateCaption('🟢 Transcription started...', false);
          console.log('✅ Overlay should now be visible');
          break;
          
        case 'TRANSCRIPTION_STATUS':
          console.log('📊 TRANSCRIPTION_STATUS:', request.isRunning);
          this.isTranscribing = request.isRunning;
          if (request.isRunning) {
            this.show();
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
          console.log('🔴 TRANSCRIPTION_STOPPED');
          this.isTranscribing = false;
          this.updateCaption('🔴 Transcription stopped', false);
          setTimeout(() => this.hide(), 2000);
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
      
      // Create animated text display with word highlighting
      if (isFinal) {
        console.log('💚 Rendering FINAL transcript');
        // Final transcript - show with completion animation
        captionText.innerHTML = `<span class="lt-final-text">${this.escapeHtml(text)}</span>`;
        captionStatus.textContent = 'Final';
        captionStatus.className = 'lt-caption-status final';
        this.currentText = text;
        
        // Add completion flash effect
        captionText.style.animation = 'ltFlashComplete 0.3s ease-out';
        setTimeout(() => {
          captionText.style.animation = '';
        }, 300);
        
      } else {
        console.log('💛 Rendering PARTIAL transcript');
        // Partial transcript - show with typing effect
        const words = text.split(' ');
        const wordsHtml = words.map((word, index) => {
          const delay = index * 0.1; // Staggered animation
          return `<span class="lt-word" style="animation-delay: ${delay}s">${this.escapeHtml(word)}</span>`;
        }).join(' ');
        
        captionText.innerHTML = `<span class="lt-partial-text">${wordsHtml}</span>`;
        captionStatus.textContent = 'Live...';
        captionStatus.className = 'lt-caption-status partial';
      }
      
      // Auto-resize overlay based on content
      this.resizeOverlay();
      
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
    console.log('🎨 SHOW() called, overlayContainer exists:', !!this.overlayContainer);
    if (this.overlayContainer) {
      // SUPER aggressive styling to force visibility
      this.overlayContainer.style.cssText = `
        display: flex !important;
        visibility: visible !important;
        opacity: 1 !important;
        z-index: 2147483647 !important;
        position: fixed !important;
        top: 50px !important;
        right: 50px !important;
        width: 400px !important;
        height: auto !important;
        background: rgba(255, 0, 0, 0.9) !important;
        color: white !important;
        padding: 20px !important;
        border: 3px solid lime !important;
        border-radius: 12px !important;
        font-family: monospace !important;
        font-size: 18px !important;
        font-weight: bold !important;
        line-height: 1.4 !important;
        pointer-events: auto !important;
        box-shadow: 0 0 20px rgba(255, 0, 0, 0.8) !important;
        flex-direction: column !important;
        gap: 12px !important;
        transform: none !important;
        clip: auto !important;
        clip-path: none !important;
        overflow: visible !important;
      `;
      
      // Add CSS animations if not already added
      if (!document.getElementById('lt-animations')) {
        const style = document.createElement('style');
        style.id = 'lt-animations';
        style.textContent = `
          @keyframes ltFlashComplete {
            0% { background-color: rgba(76, 175, 80, 0.3); }
            100% { background-color: transparent; }
          }
          
          @keyframes ltWordAppear {
            0% { opacity: 0; transform: translateY(-2px); }
            100% { opacity: 1; transform: translateY(0); }
          }
          
          .lt-word {
            display: inline-block;
            animation: ltWordAppear 0.3s ease-out forwards;
            opacity: 0;
          }
          
          .lt-final-text {
            color: #4CAF50 !important;
            font-weight: 500 !important;
          }
          
          .lt-partial-text {
            color: #FFC107 !important;
            font-weight: 400 !important;
          }
          
          .lt-caption-status.final {
            color: #4CAF50 !important;
            font-size: 12px !important;
          }
          
          .lt-caption-status.partial {
            color: #FFC107 !important;
            font-size: 12px !important;
            animation: pulse 1.5s ease-in-out infinite;
          }
          
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.6; }
          }
        `;
        document.head.appendChild(style);
      }
      this.isVisible = true;
      console.log('DEBUG_OVERLAY: Overlay forced visible with cssText override');
      
      // Make children visible too
      if (this.captionBox) {
        this.captionBox.style.cssText = `
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          color: white !important;
          margin-bottom: 10px !important;
        `;
      }
      
      if (this.agentButton) {
        this.agentButton.style.cssText = `
          display: block !important;
          visibility: visible !important;
          opacity: 1 !important;
          background: #4CAF50 !important;
          color: white !important;
          border: none !important;
          padding: 8px 12px !important;
          border-radius: 4px !important;
          cursor: pointer !important;
        `;
      }
      
      // Double-check after a moment
      setTimeout(() => {
        const computed = window.getComputedStyle(this.overlayContainer);
        console.log('DEBUG_OVERLAY: Computed styles after override:');
        console.log('  display:', computed.display);
        console.log('  visibility:', computed.visibility);
        console.log('  opacity:', computed.opacity);
        console.log('  zIndex:', computed.zIndex);
        console.log('  position:', computed.position);
        console.log('  top:', computed.top);
        console.log('  right:', computed.right);
        
        // Check if it's actually in the DOM
        const isInDOM = document.body.contains(this.overlayContainer);
        console.log('DEBUG_OVERLAY: Is overlay in DOM?', isInDOM);
        
        // Check if any parent elements are hiding it
        let parent = this.overlayContainer.parentElement;
        let depth = 0;
        while (parent && depth < 5) {
          const parentStyles = window.getComputedStyle(parent);
          console.log(`DEBUG_OVERLAY: Parent ${depth} (${parent.tagName}) - display: ${parentStyles.display}, visibility: ${parentStyles.visibility}, opacity: ${parentStyles.opacity}`);
          parent = parent.parentElement;
          depth++;
        }
      }, 100);
    } else {
      console.error('DEBUG_OVERLAY: overlayContainer is null!');
    }
  }
  
  hide() {
    if (this.overlayContainer) {
      this.overlayContainer.style.display = 'none';
      this.isVisible = false;
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
    if (this.overlayContainer) {
      this.overlayContainer.remove();
    }
    if (this.agentDialog) {
      this.agentDialog.remove();
    }
  }
}

// Initialize overlay when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new TranscriptionOverlay();
  });
} else {
  new TranscriptionOverlay();
}

// Handle page navigation
window.addEventListener('beforeunload', () => {
  if (window.transcriptionOverlay) {
    window.transcriptionOverlay.destroy();
  }
});

console.log('🎤 Live Transcription content script loaded');