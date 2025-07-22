// Content script for audio capture using AudioWorklet
class AudioCapture {
  constructor() {
    this.isCapturing = false;
    this.mediaStream = null;
    this.audioContext = null;
    this.audioWorkletNode = null;
    this.chunkCount = 0;
    
    console.log('AUDIO_CONTENT: AudioWorklet-based AudioCapture initialized');
    this.setupMessageListener();
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('AUDIO_CONTENT: Received message:', request);
      
      switch (request.type) {
        case 'START_AUDIO_CAPTURE_WITH_STREAM_ID':
          console.log('AUDIO_CONTENT: Starting audio capture with stream ID:', request.streamId);
          this.startCapture(request.streamId)
            .then(() => {
              console.log('✅ AUDIO_CONTENT: Audio capture started successfully');
              sendResponse({success: true});
            })
            .catch(error => {
              console.error('❌ AUDIO_CONTENT: Audio capture failed:', error);
              sendResponse({success: false, error: error.message});
            });
          return true; // Keep message channel open for async response
          
        case 'STOP_AUDIO_CAPTURE':
          console.log('AUDIO_CONTENT: Stopping audio capture');
          this.stopCapture();
          sendResponse({success: true});
          break;
          
        case 'PING':
          sendResponse({success: true, isCapturing: this.isCapturing});
          break;
      }
    });
  }
  
  async startCapture(streamId) {
    if (this.isCapturing) {
      throw new Error('Audio capture already running');
    }
    
    try {
      console.log('AUDIO_CONTENT: Starting audio capture with stream ID:', streamId);
      
      // Get media stream using the stream ID from tabCapture
      // Use the newer constraints format that works better in content scripts
      const constraints = {
        audio: {
          chromeMediaSource: "tab",
          chromeMediaSourceId: streamId,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000  // Try to request 16kHz directly
        }
      };
      
      console.log('AUDIO_CONTENT: Requesting getUserMedia with constraints...');
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      console.log('AUDIO_CONTENT: Got media stream with', this.mediaStream.getAudioTracks().length, 'audio tracks');
      
      // Set up audio processing
      await this.setupAudioProcessing();
      
      this.isCapturing = true;
      console.log('✅ AUDIO_CONTENT: Audio capture started successfully');
      
    } catch (error) {
      console.error('❌ AUDIO_CONTENT: Failed to start capture:', error);
      this.stopCapture();
      throw error;
    }
  }
  
  async setupAudioProcessing() {
    console.log('AUDIO_CONTENT: Setting up AudioWorklet processing...');
    
    try {
      // Create audio context with 16kHz sample rate for AssemblyAI
      this.audioContext = new AudioContext({ 
        sampleRate: 16000,
        latencyHint: 'interactive'
      });
      
      console.log('AUDIO_CONTENT: AudioContext created with sample rate:', this.audioContext.sampleRate);
      
      // Load the AudioWorklet module
      const audioProcessorUrl = chrome.runtime.getURL('audio-processor.js');
      console.log('AUDIO_CONTENT: Loading AudioWorklet from URL:', audioProcessorUrl);
      
      try {
        await this.audioContext.audioWorklet.addModule(audioProcessorUrl);
        console.log('AUDIO_CONTENT: AudioWorklet module loaded successfully');
      } catch (workletError) {
        console.error('AUDIO_CONTENT: Failed to load AudioWorklet module:', workletError);
        throw new Error('AudioWorklet module loading failed: ' + workletError.message);
      }
      
      // Create AudioWorklet node
      try {
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
        console.log('AUDIO_CONTENT: AudioWorkletNode created successfully');
      } catch (nodeError) {
        console.error('AUDIO_CONTENT: Failed to create AudioWorkletNode:', nodeError);
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
      // Note: Don't connect to destination to avoid audio feedback
      
      // Start the worklet processing
      this.audioWorkletNode.port.postMessage({ type: 'START' });
      
      // Ensure audio context is running
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      console.log('✅ AUDIO_CONTENT: AudioWorklet processing setup complete');
      console.log('AUDIO_CONTENT: AudioContext state:', this.audioContext.state);
      
    } catch (error) {
      console.error('❌ AUDIO_CONTENT: AudioWorklet setup error:', error);
      throw error;
    }
  }
  
  handleAudioData(audioData) {
    // Send audio data directly to background service worker
    chrome.runtime.sendMessage({
      type: 'AUDIO_DATA_FROM_CONTENT',
      data: Array.from(audioData.data), // Convert Int16Array to regular array
      amplitude: audioData.amplitude,
      sampleRate: 16000
    }).catch(error => {
      console.error('❌ AUDIO_CONTENT: Failed to send audio data to background:', error);
    });
    
    // Log audio activity for debugging
    this.chunkCount++;
    if (audioData.amplitude > 100 && this.chunkCount % 20 === 0) {
      console.log('🎵 AUDIO_CONTENT: Active audio sent - chunk:', this.chunkCount, 
                 'amplitude:', audioData.amplitude, 'samples:', audioData.data.length);
    } else if (this.chunkCount % 100 === 0) {
      console.log('🔇 AUDIO_CONTENT: Audio chunk sent - total:', this.chunkCount);
    }
  }
  
  stopCapture() {
    console.log('AUDIO_CONTENT: Stopping audio capture...');
    this.isCapturing = false;
    this.chunkCount = 0;
    
    // Stop AudioWorklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'STOP' });
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
      console.log('AUDIO_CONTENT: AudioWorklet stopped and disconnected');
    }
    
    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      console.log('AUDIO_CONTENT: AudioContext closed');
    }
    
    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        console.log('AUDIO_CONTENT: Track stopped:', track.label);
      });
      this.mediaStream = null;
    }
    
    console.log('🛑 AUDIO_CONTENT: Audio capture stopped completely');
  }
}

// Initialize audio capture when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    new AudioCapture();
  });
} else {
  new AudioCapture();
}

console.log('🎤 AUDIO_CONTENT: Legacy audio capture content script loaded (offscreen handles actual capture)');