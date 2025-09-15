// AudioWorklet processor for live transcription
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isProcessing = false;
    this.buffer = [];
    this.targetSampleRate = 16000; // AssemblyAI requirement
    this.resampleBuffer = [];
    this.lastSample = 0;
    
    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'START') {
        this.isProcessing = true;
      } else if (event.data.type === 'STOP') {
        this.isProcessing = false;
        this.buffer = []; // Clear buffer
        this.resampleBuffer = []; // Clear resample buffer
      }
    };
  }
  
  // Simple linear interpolation resampling
  resample(inputData, inputSampleRate, outputSampleRate) {
    if (inputSampleRate === outputSampleRate) {
      return inputData;
    }
    
    const ratio = inputSampleRate / outputSampleRate;
    const outputLength = Math.floor(inputData.length / ratio);
    const output = new Float32Array(outputLength);
    
    for (let i = 0; i < outputLength; i++) {
      const srcIndex = i * ratio;
      const srcIndexFloor = Math.floor(srcIndex);
      const srcIndexCeil = Math.min(srcIndexFloor + 1, inputData.length - 1);
      const fraction = srcIndex - srcIndexFloor;
      
      // Linear interpolation
      output[i] = inputData[srcIndexFloor] * (1 - fraction) + inputData[srcIndexCeil] * fraction;
    }
    
    return output;
  }
  
  process(inputs, outputs, parameters) {
    // Only process if we have input and processing is enabled
    if (!this.isProcessing || !inputs[0] || !inputs[0][0]) {
      return true;
    }
    
    const input = inputs[0];
    const inputData = input[0]; // Get first channel
    
    // Copy input to output unchanged (passthrough for audio quality)
    if (outputs[0] && outputs[0][0]) {
      outputs[0][0].set(inputData);
    }
    
    if (inputData && inputData.length > 0) {
      // Resample for AssemblyAI (16kHz) while keeping original for playback
      const currentSampleRate = sampleRate; // Global from AudioWorkletGlobalScope
      const resampledData = this.resample(inputData, currentSampleRate, this.targetSampleRate);
      
      // Add resampled data to buffer
      for (let i = 0; i < resampledData.length; i++) {
        this.resampleBuffer.push(resampledData[i]);
      }
      
      // Process chunks for AssemblyAI (800 samples at 16kHz = 50ms)
      const chunkSize = 800;
      while (this.resampleBuffer.length >= chunkSize) {
        const chunk = this.resampleBuffer.splice(0, chunkSize);
        
        // Convert to Int16Array for AssemblyAI
        const int16Array = new Int16Array(chunk.length);
        let maxAmplitude = 0;
        
        for (let i = 0; i < chunk.length; i++) {
          // Clamp and convert to 16-bit integer
          const sample = Math.max(-1, Math.min(1, chunk[i]));
          int16Array[i] = Math.round(sample * 32767);
          maxAmplitude = Math.max(maxAmplitude, Math.abs(int16Array[i]));
        }
        
        // Send processed audio data to main thread
        this.port.postMessage({
          type: 'AUDIO_DATA',
          data: int16Array,
          amplitude: maxAmplitude,
          originalSampleRate: currentSampleRate,
          targetSampleRate: this.targetSampleRate
        });
      }
    }
    
    return true; // Keep processor alive
  }
}

// Register the processor
registerProcessor('audio-processor', AudioProcessor);