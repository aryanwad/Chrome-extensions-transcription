// Content script for audio capture
class AudioCapture {
  constructor() {
    this.stream = null;
    this.audioContext = null;
    this.processor = null;
    this.isCapturing = false;
    
    console.log('AUDIO_INIT: AudioCapture constructor called');
    this.setupMessageListener();
    console.log('AUDIO_INIT: AudioCapture ready for messages');
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      console.log('AUDIO_CONTENT: Received message:', request);
      
      switch (request.type) {
        case 'START_AUDIO_CAPTURE':
          this.startCapture()
            .then(() => sendResponse({success: true}))
            .catch(error => sendResponse({success: false, error: error.message}));
          return true; // Keep message channel open for async response
          
        case 'STOP_AUDIO_CAPTURE':
          this.stopCapture();
          sendResponse({success: true});
          break;
          
        case 'PING':
          // Respond to ping to confirm content script is loaded
          sendResponse({success: true});
          break;
      }
    });
  }
  
  async startCapture() {
    if (this.isCapturing) {
      console.log('ERROR_ALREADY_CAPTURING: Audio capture already running');
      throw new Error('Audio capture is already running');
    }
    
    try {
      console.log('STEP_1: Checking if getDisplayMedia is available...');
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        throw new Error('ERROR_NO_DISPLAY_MEDIA: getDisplayMedia API not supported in this browser');
      }
      
      console.log('STEP_2: Requesting display media with audio...');
      
      // Request screen sharing with audio
      this.stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // We need video to get the tab option
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          sampleRate: 16000
        }
      });
      
      console.log('STEP_3: Got stream response:', this.stream);
      
      if (!this.stream) {
        throw new Error('ERROR_NO_STREAM: No media stream received from getDisplayMedia');
      }
      
      console.log('STEP_4: Checking for audio tracks...');
      
      // Check if we got audio tracks
      const audioTracks = this.stream.getAudioTracks();
      const videoTracks = this.stream.getVideoTracks();
      
      console.log(`STEP_5: Stream info - Audio tracks: ${audioTracks.length}, Video tracks: ${videoTracks.length}`);
      
      if (audioTracks.length === 0) {
        throw new Error('ERROR_NO_AUDIO_TRACK: No audio track in the stream. Make sure to check "Share audio" when selecting the tab.');
      }
      
      console.log('✅ Got media stream with audio tracks:', audioTracks.length);
      
      // Set up audio processing with AudioWorklet
      this.audioContext = new AudioContext({ sampleRate: 16000 });
      const source = this.audioContext.createMediaStreamSource(this.stream);
      
      console.log('STEP_6: Loading AudioWorklet...');
      
      // Load the AudioWorklet processor
      await this.audioContext.audioWorklet.addModule(chrome.runtime.getURL('audio-processor.js'));
      
      console.log('STEP_7: Creating AudioWorkletNode...');
      
      // Create AudioWorkletNode
      this.processor = new AudioWorkletNode(this.audioContext, 'audio-processor');
      
      // Listen for processed audio data
      this.processor.port.onmessage = (event) => {
        if (!this.isCapturing) return;
        
        if (event.data.type === 'AUDIO_DATA') {
          console.log('AUDIO_WORKLET: Received', event.data.data.length, 'audio samples from worklet');
          // Send audio data to background script
          chrome.runtime.sendMessage({
            type: 'AUDIO_DATA',
            data: Array.from(event.data.data) // Convert Int16Array to array for message passing
          });
        }
      };
      
      // Start processing
      this.processor.port.postMessage({ type: 'START' });
      
      source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      
      this.isCapturing = true;
      console.log('✅ Audio capture started successfully');
      
      // Handle stream end
      this.stream.getTracks().forEach(track => {
        track.onended = () => {
          console.log('Media track ended');
          this.stopCapture();
        };
      });
      
    } catch (error) {
      console.error('Audio capture failed:', error);
      this.stopCapture();
      throw error;
    }
  }
  
  stopCapture() {
    this.isCapturing = false;
    
    if (this.processor) {
      // Stop the AudioWorklet processing
      this.processor.port.postMessage({ type: 'STOP' });
      this.processor.disconnect();
      this.processor = null;
    }
    
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    
    console.log('🛑 Audio capture stopped');
    
    // Notify background script
    chrome.runtime.sendMessage({
      type: 'AUDIO_CAPTURE_STOPPED'
    });
  }
}

// Initialize audio capture when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    console.log('AUDIO_INIT: DOM loaded, creating AudioCapture...');
    new AudioCapture();
  });
} else {
  console.log('AUDIO_INIT: DOM ready, creating AudioCapture...');
  new AudioCapture();
}

console.log('🎤 Audio capture content script loaded at:', new Date().toISOString());