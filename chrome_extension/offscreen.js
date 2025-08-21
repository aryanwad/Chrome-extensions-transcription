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
    
    // Chunked video transfer storage
    this.videoTransfers = new Map(); // Store ongoing transfers by transferId
    
    this.setupMessageListener();
  }
  
  setupMessageListener() {
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      
      // Only handle messages that are intended for the offscreen document
      if (!this.isOffscreenMessage(request.type)) {
        return false; // Let other handlers process this message
      }
      
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
          
        case 'PROCESS_VIDEO_FOR_AUDIO':
          this.processVideoForAudio(request.videoData, request.durationMinutes)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true; // Keep message channel open for async response
          
        case 'INIT_CHUNKED_VIDEO_TRANSFER':
          this.initChunkedVideoTransfer(request.transferId, request.totalSize, request.totalChunks, request.durationMinutes)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
          
        case 'VIDEO_CHUNK':
          this.receiveVideoChunk(request.transferId, request.chunkIndex, request.chunkData, request.isLastChunk)
            .then(() => sendResponse({ success: true }))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
          
        case 'FINALIZE_CHUNKED_VIDEO_TRANSFER':
          this.finalizeChunkedVideoTransfer(request.transferId)
            .then(result => sendResponse({ success: true, data: result }))
            .catch(error => sendResponse({ success: false, error: error.message }));
          return true;
          
        case 'CLEANUP_OFFSCREEN':
          this.cleanup();
          sendResponse({ success: true });
          break;
          
        default:
          sendResponse({ success: false, error: `Unknown message type: ${request.type}` });
          break;
      }
    });
  }
  
  isOffscreenMessage(messageType) {
    const offscreenMessageTypes = [
      'START_OFFSCREEN_CAPTURE',
      'STOP_OFFSCREEN_CAPTURE', 
      'PROCESS_VIDEO_FOR_AUDIO',
      'INIT_CHUNKED_VIDEO_TRANSFER',
      'VIDEO_CHUNK',
      'FINALIZE_CHUNKED_VIDEO_TRANSFER',
      'CLEANUP_OFFSCREEN'
    ];
    return offscreenMessageTypes.includes(messageType);
  }
  
  async startCapture(streamId) {
    if (this.isProcessing) {
      throw new Error('Audio processing already running');
    }
    
    try {
      
      // Use getUserMedia with the stream ID from tabCapture.getMediaStreamId
      // This is the proper way to use tab capture in offscreen documents
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
      
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      
      const audioTracks = this.mediaStream.getAudioTracks();
      
      if (audioTracks.length === 0) {
        throw new Error('No audio tracks in the captured stream');
      }
      
      // Set up audio processing
      await this.setupAudioProcessing();
      this.isProcessing = true;
      
      
    } catch (error) {
      console.error('❌ Failed to start capture:', error);
      this.stopCapture();
      throw error;
    }
  }
  
  async setupAudioProcessing() {
    
    try {
      // Create audio context with native sample rate for better quality
      // We'll downsample only for AssemblyAI processing, not for playback
      this.audioContext = new AudioContext({ 
        latencyHint: 'interactive'
      });
      
      
      // Load the AudioWorklet module
      const audioProcessorUrl = chrome.runtime.getURL('audio-processor.js');
      
      try {
        await this.audioContext.audioWorklet.addModule(audioProcessorUrl);
      } catch (workletError) {
        console.error('❌ Failed to load AudioWorklet module:', workletError);
        throw new Error('AudioWorklet module loading failed: ' + workletError.message);
      }
      
      // Create AudioWorklet node
      try {
        this.audioWorkletNode = new AudioWorkletNode(this.audioContext, 'audio-processor');
      } catch (nodeError) {
        console.error('❌ Failed to create AudioWorkletNode:', nodeError);
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
      
      // Start the worklet processing
      this.audioWorkletNode.port.postMessage({ type: 'START' });
      
      // Ensure audio context is running
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      
      
    } catch (error) {
      console.error('❌ AudioWorklet setup error:', error);
      throw error;
    }
  }
  
  handleAudioData(audioData) {
    // Don't process audio data if we're no longer processing
    if (!this.isProcessing) {
      return;
    }
    
    
    // Send audio data to background service worker
    chrome.runtime.sendMessage({
      type: 'AUDIO_DATA_FROM_OFFSCREEN',
      data: Array.from(audioData.data), // Convert Int16Array to regular array
      amplitude: audioData.amplitude,
      sampleRate: 16000
    }).then(response => {
      // If background service responds that transcription is stopped, stop processing
      if (response && !response.success && response.reason === 'transcription_stopped') {
        this.stopCapture();
      }
    }).catch(error => {
      console.error('❌ Failed to send audio data to background:', error);
      // If we can't communicate with background, stop processing
      this.stopCapture();
    });
    
    // Track chunk count for internal processing
    this.chunkCount = (this.chunkCount || 0) + 1;
  }
  
  stopCapture() {
    this.isProcessing = false;
    this.chunkCount = 0;
    
    // Stop AudioWorklet
    if (this.audioWorkletNode) {
      this.audioWorkletNode.port.postMessage({ type: 'STOP' });
      this.audioWorkletNode.disconnect();
      this.audioWorkletNode = null;
    }
    
    // Close audio context
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    
    // Stop media stream
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
      });
      this.mediaStream = null;
    }
    
  }
  
  async processVideoForAudio(videoData, durationMinutes) {
    try {
      console.log('🎬 Processing video for audio extraction');
      console.log('📊 Video data array length:', videoData.length, 'bytes');
      console.log('📊 Duration target:', durationMinutes, 'minutes');
      
      // Convert array data back to ArrayBuffer
      const uint8Array = new Uint8Array(videoData);
      const videoBuffer = uint8Array.buffer;
      
      console.log('📊 Video buffer restored:', (videoBuffer.byteLength / 1024 / 1024).toFixed(2), 'MB');
      
      // Create a blob from the video buffer
      const videoBlob = new Blob([videoBuffer], { type: 'video/mp2t' }); // TS format from m3u8
      console.log('📊 Video blob created:', videoBlob.size, 'bytes, type:', videoBlob.type);
      const videoUrl = URL.createObjectURL(videoBlob);
      console.log('📊 Video URL created:', videoUrl.substring(0, 50) + '...');
      
      try {
        // Create video element to decode the video
        const video = document.createElement('video');
        video.src = videoUrl;
        video.muted = true;
        
        // Wait for video metadata to load
        await new Promise((resolve, reject) => {
          video.addEventListener('loadedmetadata', () => {
            console.log('✅ Video metadata loaded successfully');
            resolve();
          });
          video.addEventListener('error', (event) => {
            console.error('❌ Video loading error:', event);
            console.error('Video error details:', {
              error: video.error,
              networkState: video.networkState,
              readyState: video.readyState,
              src: video.src ? video.src.substring(0, 100) + '...' : 'No src'
            });
            reject(new Error(`Video loading failed: ${video.error ? video.error.message : 'Unknown error'}`));
          });
          console.log('🎬 Loading video for audio extraction...');
          video.load();
        });
        
        
        // Create audio context for processing
        const audioContext = new (window.AudioContext || window.webkitAudioContext)({
          sampleRate: 16000 // Target sample rate for transcription
        });
        
        // Create media element source
        const source = audioContext.createMediaElementSource(video);
        
        // Create script processor for audio capture
        const bufferSize = 4096;
        const processor = audioContext.createScriptProcessor(bufferSize, 1, 1);
        
        const audioChunks = [];
        let totalSamples = 0;
        
        processor.onaudioprocess = (event) => {
          const inputBuffer = event.inputBuffer;
          const outputBuffer = event.outputBuffer;
          
          // Copy input to output (passthrough)
          for (let channel = 0; channel < outputBuffer.numberOfChannels; channel++) {
            const input = inputBuffer.getChannelData(channel);
            const output = outputBuffer.getChannelData(channel);
            
            // Convert float32 to int16 for AssemblyAI
            const int16Array = new Int16Array(input.length);
            for (let i = 0; i < input.length; i++) {
              // Clamp to [-1, 1] and convert to int16 range
              const clampedValue = Math.max(-1, Math.min(1, input[i]));
              int16Array[i] = Math.round(clampedValue * 32767);
              output[i] = input[i]; // Passthrough
            }
            
            audioChunks.push(int16Array);
            totalSamples += int16Array.length;
          }
        };
        
        // Connect audio pipeline
        source.connect(processor);
        processor.connect(audioContext.destination);
        
        // Play the video to extract audio
        video.play();
        
        // Wait for video to finish or reach duration limit
        const targetDurationSeconds = durationMinutes * 60;
        await new Promise((resolve) => {
          const checkInterval = setInterval(() => {
            if (video.ended || video.currentTime >= targetDurationSeconds) {
              clearInterval(checkInterval);
              video.pause();
              resolve();
            }
          }, 100);
        });
        
        // Cleanup
        processor.disconnect();
        source.disconnect();
        audioContext.close();
        URL.revokeObjectURL(videoUrl);
        
        // Combine all audio chunks
        const totalAudio = new Int16Array(totalSamples);
        let offset = 0;
        for (const chunk of audioChunks) {
          totalAudio.set(chunk, offset);
          offset += chunk.length;
        }
        
        
        // Convert to ArrayBuffer for transmission
        const audioBuffer = totalAudio.buffer;
        
        return {
          audioBuffer: audioBuffer,
          sampleRate: 16000,
          samples: totalSamples,
          durationSeconds: totalSamples / 16000
        };
        
      } finally {
        URL.revokeObjectURL(videoUrl);
      }
      
    } catch (error) {
      console.error('❌ Video to audio conversion failed:', error);
      throw error;
    }
  }
  
  async initChunkedVideoTransfer(transferId, totalSize, totalChunks, durationMinutes) {
    try {
      console.log('🔄 Initializing chunked video transfer:', {
        transferId: transferId,
        totalSize: (totalSize / 1024 / 1024).toFixed(2) + ' MB',
        totalChunks: totalChunks,
        duration: durationMinutes + ' minutes'
      });
      
      this.videoTransfers.set(transferId, {
        totalSize: totalSize,
        totalChunks: totalChunks,
        durationMinutes: durationMinutes,
        chunks: new Array(totalChunks),
        receivedChunks: 0,
        startTime: Date.now()
      });
      
      console.log('✅ Chunked transfer initialized');
    } catch (error) {
      console.error('❌ Failed to initialize chunked transfer:', error);
      throw error;
    }
  }
  
  async receiveVideoChunk(transferId, chunkIndex, chunkData, isLastChunk) {
    try {
      const transfer = this.videoTransfers.get(transferId);
      if (!transfer) {
        throw new Error(`Transfer ${transferId} not found`);
      }
      
      // Store the chunk
      transfer.chunks[chunkIndex] = chunkData;
      transfer.receivedChunks++;
      
      console.log(`📦 Received chunk ${chunkIndex + 1}/${transfer.totalChunks} (${(chunkData.length / 1024 / 1024).toFixed(2)} MB)`);
      
      if (isLastChunk || transfer.receivedChunks === transfer.totalChunks) {
        console.log('📊 All chunks received, ready for finalization');
      }
      
    } catch (error) {
      console.error('❌ Failed to receive video chunk:', error);
      throw error;
    }
  }
  
  async finalizeChunkedVideoTransfer(transferId) {
    try {
      const transfer = this.videoTransfers.get(transferId);
      if (!transfer) {
        throw new Error(`Transfer ${transferId} not found`);
      }
      
      console.log('🔄 Finalizing chunked video transfer...');
      
      // Check all chunks received
      if (transfer.receivedChunks !== transfer.totalChunks) {
        throw new Error(`Missing chunks: received ${transfer.receivedChunks}/${transfer.totalChunks}`);
      }
      
      // Concatenate all chunks
      console.log('📊 Concatenating video chunks...');
      const totalSize = transfer.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const videoArray = new Uint8Array(totalSize);
      
      let offset = 0;
      for (let i = 0; i < transfer.chunks.length; i++) {
        const chunk = transfer.chunks[i];
        if (!chunk) {
          throw new Error(`Missing chunk ${i}`);
        }
        videoArray.set(chunk, offset);
        offset += chunk.length;
      }
      
      console.log('✅ Video reconstruction complete:', {
        totalSize: (totalSize / 1024 / 1024).toFixed(2) + ' MB',
        transferTime: ((Date.now() - transfer.startTime) / 1000).toFixed(1) + 's'
      });
      
      // Process the video for audio extraction
      const result = await this.processVideoForAudio(Array.from(videoArray), transfer.durationMinutes);
      
      // Clean up transfer data
      this.videoTransfers.delete(transferId);
      
      return result;
      
    } catch (error) {
      console.error('❌ Failed to finalize chunked transfer:', error);
      // Clean up on error
      this.videoTransfers.delete(transferId);
      throw error;
    }
  }
  
  cleanup() {
    this.stopCapture();
    
    // Clean up any ongoing video transfers
    this.videoTransfers.clear();
    
    // Additional cleanup if needed
  }
}

// Initialize the offscreen audio processor
const offscreenProcessor = new OffscreenAudioProcessor();

// Add global reference for debugging
window.offscreenProcessor = offscreenProcessor;

