// Offscreen document for handling tab capture in Manifest V3
// Implements proper audio processing for AssemblyAI compatibility
class OffscreenAudioProcessor {
  constructor() {
    this.mediaStream = null;
    this.audioContext = null;
    this.processor = null;
    this.isProcessing = false;
    this.audioBuffer = [];
    this.chunkSize = 800; // 50ms at 16kHz (16000 * 0.05 = 800 samples)
    
    console.log('OFFSCREEN: Audio processor initialized for AssemblyAI compatibility');
    this.setupMessageListener();
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('OFFSCREEN: Received message:', request);
      
      switch (request.type) {
        case 'START_OFFSCREEN_CAPTURE':
          this.startCapture(request.streamId)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true; // Keep message channel open for async response
          
        case 'STOP_OFFSCREEN_CAPTURE':
          this.stopCapture();
          sendResponse({ success: true });
          break;
      }
    });
  }
  
  async startCapture(streamId) {
    if (this.isProcessing) {
      throw new Error('Audio processing already running');
    }
    
    try {
      console.log('OFFSCREEN: Starting capture with stream ID:', streamId);
      
      // Use getUserMedia with the stream ID from tabCapture.getMediaStreamId
      // This is the proper way to use tab capture in offscreen documents
      console.log('OFFSCREEN: Requesting getUserMedia with constraints...');
      const constraints = {
        audio: {
          mandatory: {
            chromeMediaSource: "tab",
            chromeMediaSourceId: streamId,
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            googEchoCancellation: false,
            googAutoGainControl: false,
            googNoiseSuppression: false,
            googHighpassFilter: false
          }
        }
      };
      
      console.log('OFFSCREEN: getUserMedia constraints:', JSON.stringify(constraints, null, 2));
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log('OFFSCREEN: Got media stream with', this.mediaStream.getAudioTracks().length, 'audio tracks');
      
      // Log audio track details
      const audioTracks = this.mediaStream.getAudioTracks();
      audioTracks.forEach((track, index) => {
        console.log(`OFFSCREEN: Audio Track ${index}:`, {
          label: track.label,
          enabled: track.enabled,
          muted: track.muted,
          readyState: track.readyState,
          settings: track.getSettings()
        });
      });
      
      if (audioTracks.length === 0) {
        throw new Error('No audio tracks in the captured stream');
      }
      
      // Set up audio processing
      await this.setupAudioProcessing();
      this.isProcessing = true;
      
      console.log('✅ OFFSCREEN: Audio capture started successfully');
      
    } catch (error) {
      console.error('OFFSCREEN: Failed to start capture:', error);
      this.stopCapture();
      throw error;
    }
  }
  
  async setupAudioProcessing() {
    console.log('OFFSCREEN: Setting up AudioWorklet processing for AssemblyAI...');
    
    try {
      // Create audio context with native sample rate for better quality
      // We'll downsample only for AssemblyAI processing, not for playback
      this.audioContext = new AudioContext({ 
        latencyHint: 'interactive'
      });
      
      console.log('OFFSCREEN: AudioContext created with sample rate:', this.audioContext.sampleRate);
      
      // Load the AudioWorklet module
      const audioProcessorUrl = chrome.runtime.getURL('audio-processor.js');
      console.log('OFFSCREEN: Loading AudioWorklet from URL:', audioProcessorUrl);
      
      try {
        await this.audioContext.audioWorklet.addModule(audioProcessorUrl);
        console.log('OFFSCREEN: AudioWorklet module loaded successfully');
      } catch (workletError) {
        console.error('OFFSCREEN: Failed to load AudioWorklet module:', workletError);
        throw new Error('AudioWorklet module loading failed: ' + workletError.message);
      }
      
      // Create AudioWorklet node
      try {
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
        console.log('OFFSCREEN: AudioWorkletNode created successfully');
      } catch (nodeError) {
        console.error('OFFSCREEN: Failed to create AudioWorkletNode:', nodeError);
        throw new Error('AudioWorkletNode creation failed: ' + nodeError.message);
      }
      
      // Listen for audio data from the worklet
      this.audioWorkletNode.port.onmessage = (event) => {
        if (event.data.type === 'AUDIO_DATA') {
          this.handleAudioData(event.data);
        }
      };
      
      // Create media stream source
      const source = this.audioContext.createMediaStreamSource(this.mediaStream);
      
      // Connect: source -> AudioWorklet
      source.connect(this.audioWorkletNode);
      
      // Enable audio loopback so user can still hear the audio
      // This is safe in offscreen context as there's no speaker feedback risk
      source.connect(this.audioContext.destination);
      console.log('OFFSCREEN: Audio loopback enabled - you should hear the captured audio');
      
      // Start the worklet processing
      this.audioWorkletNode.port.postMessage({ type: 'START' });
      
      // Ensure audio context is running
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      console.log('✅ OFFSCREEN: AudioWorklet processing setup complete');
      console.log('OFFSCREEN: AudioContext state:', this.audioContext.state);
      
    } catch (error) {
      console.error('❌ OFFSCREEN: AudioWorklet setup error:', error);
      throw error;
    }
  }
  
  handleAudioData(audioData) {
    // Don't process audio data if we're no longer processing
    if (!this.isProcessing) {
      return;
    }
    
    // Debug: Log audio data flow
    console.log('OFFSCREEN: Handling audio data, amplitude:', audioData.amplitude);
    
    // Send audio data to background service worker
    chrome.runtime.sendMessage({
      type: 'AUDIO_DATA_FROM_OFFSCREEN',
      data: Array.from(audioData.data), // Convert Int16Array to regular array
      amplitude: audioData.amplitude,
      sampleRate: 16000
    }).then(response => {
      // If background service responds that transcription is stopped, stop processing
      if (response && !response.success && response.reason === 'transcription_stopped') {
        console.log('🛑 OFFSCREEN: Background service stopped transcription, stopping audio processing');
        this.stopCapture();
      }
    }).catch(error => {
      console.error('❌ OFFSCREEN: Failed to send audio data to background:', error);
      // If we can't communicate with background, stop processing
      this.stopCapture();
    });
    
    // Track chunk count for internal processing
    this.chunkCount = (this.chunkCount || 0) + 1;
  }
  
  stopCapture() {
    console.log('OFFSCREEN: Stopping audio capture...');
    this.isProcessing = false;
    this.chunkCount = 0;
    
    // Stop AudioWorklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'STOP' });
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
      console.log('OFFSCREEN: AudioWorklet stopped and disconnected');
    }
    
    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      console.log('OFFSCREEN: AudioContext closed');
    }
    
    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        console.log('OFFSCREEN: Track stopped:', track.label);
      });
      this.mediaStream = null;
    }
    
    console.log('🛑 OFFSCREEN: Audio capture stopped completely');
  }
}

// Initialize the offscreen audio processor
new OffscreenAudioProcessor();

console.log('🎤 OFFSCREEN: AssemblyAI-compatible audio processor loaded at:', new Date().toISOString());