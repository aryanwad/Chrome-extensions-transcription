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
    
    // Create Catch-Up button
    this.catchupButton = document.createElement('button');
    this.catchupButton.className = 'lt-catchup-button';
    this.catchupButton.innerHTML = '⚡ Catch Up';
    this.catchupButton.onclick = () => this.showCatchupDialog();
    
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
    buttonContainer.appendChild(this.catchupButton);
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
          
          // Always show overlay when we get transcript
          this.show();
          
          if (request.isFinal) {
            this.updateCaption(request.text, true);
          } else {
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
  
  // Check if catch-up button should be visible
  shouldShowCatchupButton() {
    const url = window.location.href.toLowerCase();
    return url.includes('twitch.tv') || 
           url.includes('youtube.com') || 
           url.includes('youtu.be') || 
           url.includes('kick.com');
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
        margin-right: 8px !important;
      `;
    }
    
    if (this.catchupButton) {
      // Show/hide catch-up button based on platform
      const shouldShow = this.shouldShowCatchupButton() && this.isTranscribing;
      this.catchupButton.style.cssText = `
        ${shouldShow ? 'display: inline-block' : 'display: none'} !important;
        background: #FF9800 !important;
        color: white !important;
        border: none !important;
        padding: 8px 12px !important;
        border-radius: 4px !important;
        cursor: pointer !important;
        font-size: 12px !important;
        transition: background-color 0.2s !important;
        margin-right: 8px !important;
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
  
  showCatchupDialog() {
    if (this.catchupDialog) {
      this.catchupDialog.remove();
    }
    
    // Create catch-up dialog
    this.catchupDialog = document.createElement('div');
    this.catchupDialog.className = 'lt-catchup-dialog';
    this.catchupDialog.innerHTML = `
      <div class="lt-catchup-content">
        <div class="lt-catchup-header">
          <h3>⚡ Smart Stream Catch-Up</h3>
          <button class="lt-close-btn" onclick="this.closest('.lt-catchup-dialog').remove()">×</button>
        </div>
        <div class="lt-catchup-body">
          <p>🎯 Get an AI-powered summary with deep links and key moments!</p>
          <div class="feature-highlights">
            <span class="feature-tag">🔗 VOD Deep Links</span>
            <span class="feature-tag">⏰ Key Moments</span>
            <span class="feature-tag">🤖 AI Analysis</span>
          </div>
          <div class="lt-duration-options">
            <button class="lt-duration-btn" data-duration="30">
              <div class="duration-title">Last 30 Minutes</div>
              <div class="duration-desc">Quick summary - FREE</div>
            </button>
            <button class="lt-duration-btn" data-duration="60">
              <div class="duration-title">Last 60 Minutes</div>
              <div class="duration-desc">Detailed summary - FREE</div>
            </button>
          </div>
          <div class="lt-processing-section" style="display: none;">
            <div class="lt-progress-bar">
              <div class="lt-progress-fill"></div>
            </div>
            <div class="lt-progress-text">Analyzing stream...</div>
          </div>
          <div class="lt-result-section" style="display: none;">
            <h4>📊 Stream Summary</h4>
            <div class="lt-summary-content"></div>
            <button class="lt-close-result-btn">Close</button>
          </div>
        </div>
      </div>
    `;
    
    // Add dialog styling
    this.catchupDialog.style.cssText = `
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      background: rgba(0, 0, 0, 0.8) !important;
      z-index: 2147483648 !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      font-family: 'Segoe UI', Arial, sans-serif !important;
    `;
    
    document.body.appendChild(this.catchupDialog);
    this.setupCatchupHandlers();
  }
  
  setupCatchupHandlers() {
    const durationButtons = this.catchupDialog.querySelectorAll('.lt-duration-btn');
    const processingSection = this.catchupDialog.querySelector('.lt-processing-section');
    const resultSection = this.catchupDialog.querySelector('.lt-result-section');
    const progressFill = this.catchupDialog.querySelector('.lt-progress-fill');
    const progressText = this.catchupDialog.querySelector('.lt-progress-text');
    const summaryContent = this.catchupDialog.querySelector('.lt-summary-content');
    
    // Handle duration selection
    durationButtons.forEach(btn => {
      btn.onclick = async () => {
        const duration = parseInt(btn.dataset.duration);
        await this.processCatchupRequest(duration, processingSection, resultSection, progressFill, progressText, summaryContent);
      };
    });
    
    // Handle close result button
    const closeResultBtn = this.catchupDialog.querySelector('.lt-close-result-btn');
    closeResultBtn.onclick = () => {
      this.catchupDialog.remove();
    };
    
    // Add CSS for the dialog content
    const style = document.createElement('style');
    style.textContent = `
      .lt-catchup-content {
        background: white !important;
        border-radius: 12px !important;
        max-width: 500px !important;
        width: 90% !important;
        max-height: 80vh !important;
        overflow-y: auto !important;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3) !important;
      }
      
      .lt-catchup-header {
        padding: 20px 24px 0 24px !important;
        display: flex !important;
        justify-content: space-between !important;
        align-items: center !important;
        border-bottom: 1px solid #eee !important;
        margin-bottom: 0 !important;
      }
      
      .lt-catchup-header h3 {
        margin: 0 0 16px 0 !important;
        color: #333 !important;
        font-size: 20px !important;
      }
      
      .lt-close-btn {
        background: none !important;
        border: none !important;
        font-size: 24px !important;
        cursor: pointer !important;
        color: #666 !important;
        padding: 0 !important;
        margin: 0 0 16px 0 !important;
      }
      
      .lt-catchup-body {
        padding: 24px !important;
      }
      
      .lt-catchup-body p {
        margin: 0 0 24px 0 !important;
        color: #666 !important;
        font-size: 16px !important;
      }
      
      .lt-duration-options {
        display: flex !important;
        gap: 16px !important;
        margin-bottom: 24px !important;
      }
      
      .lt-duration-btn {
        flex: 1 !important;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%) !important;
        color: white !important;
        border: none !important;
        border-radius: 8px !important;
        padding: 20px 16px !important;
        cursor: pointer !important;
        transition: transform 0.2s, box-shadow 0.2s !important;
      }
      
      .lt-duration-btn:hover {
        transform: translateY(-2px) !important;
        box-shadow: 0 8px 25px rgba(102, 126, 234, 0.4) !important;
      }
      
      .duration-title {
        font-size: 16px !important;
        font-weight: 600 !important;
        margin-bottom: 4px !important;
      }
      
      .duration-desc {
        font-size: 14px !important;
        opacity: 0.9 !important;
      }
      
      .lt-progress-bar {
        width: 100% !important;
        height: 8px !important;
        background: #f0f0f0 !important;
        border-radius: 4px !important;
        overflow: hidden !important;
        margin-bottom: 16px !important;
      }
      
      .lt-progress-fill {
        height: 100% !important;
        background: linear-gradient(90deg, #667eea, #764ba2) !important;
        border-radius: 4px !important;
        transition: width 0.3s ease !important;
        width: 0% !important;
      }
      
      .lt-progress-text {
        text-align: center !important;
        color: #666 !important;
        font-size: 14px !important;
        margin-bottom: 16px !important;
      }
      
      .lt-result-section h4 {
        margin: 0 0 16px 0 !important;
        color: #333 !important;
        font-size: 18px !important;
      }
      
      .lt-summary-content {
        background: #f8f9fa !important;
        border-radius: 8px !important;
        padding: 20px !important;
        margin-bottom: 24px !important;
        line-height: 1.6 !important;
        color: #333 !important;
        font-size: 14px !important;
      }
      
      .lt-close-result-btn {
        background: #667eea !important;
        color: white !important;
        border: none !important;
        border-radius: 6px !important;
        padding: 12px 24px !important;
        cursor: pointer !important;
        font-size: 14px !important;
        font-weight: 600 !important;
      }
      
      .platform-badge {
        display: inline-block !important;
        padding: 4px 8px !important;
        border-radius: 12px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
        margin-right: 8px !important;
      }
      
      .platform-badge.twitch {
        background: #9146ff !important;
        color: white !important;
      }
      
      .platform-badge.youtube {
        background: #ff0000 !important;
        color: white !important;
      }
      
      .platform-badge.kick {
        background: #53fc18 !important;
        color: black !important;
      }
      
      .platform-badge.unknown {
        background: #666 !important;
        color: white !important;
      }
      
      .deep-link-badge {
        display: inline-block !important;
        padding: 4px 8px !important;
        background: #ff9800 !important;
        color: white !important;
        border-radius: 12px !important;
        font-size: 11px !important;
        font-weight: 600 !important;
      }
      
      .summary-header {
        display: flex !important;
        align-items: center !important;
        margin-bottom: 16px !important;
        padding-bottom: 8px !important;
        border-bottom: 1px solid #eee !important;
      }
      
      .summary-content {
        margin-bottom: 20px !important;
        line-height: 1.6 !important;
      }
      
      .stats-grid {
        display: grid !important;
        grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)) !important;
        gap: 8px !important;
        margin-top: 8px !important;
      }
      
      .stat-item {
        display: flex !important;
        flex-direction: column !important;
        background: #f8f9fa !important;
        padding: 8px !important;
        border-radius: 6px !important;
      }
      
      .stat-label {
        font-size: 12px !important;
        color: #666 !important;
        margin-bottom: 2px !important;
      }
      
      .stat-value {
        font-weight: 600 !important;
        color: #333 !important;
        font-size: 14px !important;
      }
      
      .vod-link {
        display: inline-block !important;
        padding: 10px 16px !important;
        background: linear-gradient(135deg, #667eea, #764ba2) !important;
        color: white !important;
        text-decoration: none !important;
        border-radius: 6px !important;
        margin-top: 8px !important;
        transition: transform 0.2s !important;
      }
      
      .vod-link:hover {
        transform: translateY(-1px) !important;
      }
      
      .timestamp-link {
        display: inline-block !important;
        padding: 2px 6px !important;
        background: #667eea !important;
        color: white !important;
        text-decoration: none !important;
        border-radius: 4px !important;
        font-size: 12px !important;
        margin: 0 2px !important;
      }
      
      .transcript-container {
        max-height: 250px !important;
        overflow-y: auto !important;
        margin-top: 8px !important;
        border: 1px solid #ddd !important;
        border-radius: 6px !important;
      }
      
      .transcript-text {
        padding: 12px !important;
        font-size: 12px !important;
        line-height: 1.5 !important;
        background: white !important;
        color: #333 !important;
      }
      
      .feature-highlights {
        display: flex !important;
        gap: 8px !important;
        flex-wrap: wrap !important;
        margin-top: 12px !important;
      }
      
      .feature-tag {
        display: inline-block !important;
        padding: 4px 8px !important;
        background: rgba(102, 126, 234, 0.1) !important;
        color: #667eea !important;
        border: 1px solid rgba(102, 126, 234, 0.2) !important;
        border-radius: 12px !important;
        font-size: 11px !important;
        font-weight: 500 !important;
      }
    `;
    document.head.appendChild(style);
  }
  
  async processCatchupRequest(duration, processingSection, resultSection, progressFill, progressText, summaryContent) {
    try {
      // Hide duration options and show processing
      this.catchupDialog.querySelector('.lt-duration-options').style.display = 'none';
      processingSection.style.display = 'block';
      
      // Update progress: Starting
      this.updateProgress(progressFill, progressText, 10, 'Getting stream information...');
      
      // Get current tab URL
      const currentUrl = window.location.href;
      console.log('🎯 CATCHUP: Processing request for URL:', currentUrl, 'Duration:', duration + 'min');
      
      // Send request to background script
      const response = await new Promise((resolve, reject) => {
        chrome.runtime.sendMessage({
          type: 'REQUEST_CATCHUP',
          streamUrl: currentUrl,
          duration: duration
        }, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
      
      if (!response.success) {
        throw new Error(response.error || 'Failed to process catch-up request');
      }
      
      // Check if we got immediate completion (serverless processing)
      if (response.status === 'complete' && response.data) {
        console.log('✅ CATCHUP: Processing completed immediately');
        this.updateProgress(progressFill, progressText, 100, 'Processing complete!');
        this.showCatchupResult(response.data, summaryContent, processingSection, resultSection);
      } else {
        // Fallback to old polling system if needed (backward compatibility)
        console.log('✅ CATCHUP: Request initiated, task ID:', response.taskId);
        await this.pollCatchupProgress(response.taskId, progressFill, progressText, summaryContent, processingSection, resultSection);
      }
      
    } catch (error) {
      console.error('❌ CATCHUP: Error processing request:', error);
      progressText.textContent = 'Error: ' + error.message;
      progressFill.style.background = '#f44336';
      
      // Show error message
      setTimeout(() => {
        processingSection.style.display = 'none';
        this.catchupDialog.querySelector('.lt-duration-options').style.display = 'flex';
      }, 3000);
    }
  }
  
  async pollCatchupProgress(taskId, progressFill, progressText, summaryContent, processingSection, resultSection) {
    const maxAttempts = 60; // 60 attempts * 2 seconds = 2 minutes max
    let attempts = 0;
    
    const pollInterval = setInterval(async () => {
      attempts++;
      
      try {
        const response = await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage({
            type: 'CHECK_CATCHUP_STATUS',
            taskId: taskId
          }, (response) => {
            if (chrome.runtime.lastError) {
              reject(new Error(chrome.runtime.lastError.message));
            } else {
              resolve(response);
            }
          });
        });
        
        if (response.success) {
          const { status, progress, message, result } = response.data;
          
          // Update progress bar
          this.updateProgress(progressFill, progressText, progress, message);
          
          if (status === 'complete' && result) {
            clearInterval(pollInterval);
            this.showCatchupResult(result, summaryContent, processingSection, resultSection);
          } else if (status === 'failed') {
            clearInterval(pollInterval);
            throw new Error(message || 'Processing failed');
          }
        }
        
      } catch (error) {
        clearInterval(pollInterval);
        console.error('❌ CATCHUP: Progress polling error:', error);
        progressText.textContent = 'Error checking progress: ' + error.message;
      }
      
      // Timeout after max attempts
      if (attempts >= maxAttempts) {
        clearInterval(pollInterval);
        progressText.textContent = 'Request timed out. Please try again.';
      }
    }, 2000); // Poll every 2 seconds
  }
  
  updateProgress(progressFill, progressText, progress, message) {
    progressFill.style.width = progress + '%';
    progressText.textContent = message || `Processing... ${progress}%`;
  }
  
  showCatchupResult(result, summaryContent, processingSection, resultSection) {
    // Hide processing section
    processingSection.style.display = 'none';
    
    // Format and show results
    summaryContent.innerHTML = this.formatSummaryResult(result);
    resultSection.style.display = 'block';
    
    console.log('✅ CATCHUP: Results displayed successfully');
  }
  
  formatSummaryResult(result) {
    return `
      <div class="summary-section">
        <h5>📝 Key Events</h5>
        <p>${result.summary || 'Summary not available'}</p>
      </div>
      
      <div class="summary-section">
        <h5>⏱️ Processing Details</h5>
        <p>Duration: ${result.duration || 'N/A'} minutes<br>
        Clips processed: ${result.clipsProcessed || 'N/A'}<br>
        Processing time: ${result.processingTime || 'N/A'} seconds</p>
      </div>
      
      ${result.fullTranscript ? `
      <div class="summary-section">
        <h5>📋 Full Transcript</h5>
        <div class="transcript-text" style="max-height: 200px; overflow-y: auto; font-size: 12px; background: white; padding: 12px; border-radius: 4px; margin-top: 8px;">
          ${this.escapeHtml(result.fullTranscript)}
        </div>
      </div>
      ` : ''}
    `;
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