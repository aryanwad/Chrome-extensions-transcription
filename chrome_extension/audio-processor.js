// AudioWorklet processor for live transcription
class AudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.isProcessing = false;
    this.bufferSize = 4096;
    this.buffer = [];
    
    // Listen for messages from main thread
    this.port.onmessage = (event) => {
      if (event.data.type === 'START') {
        this.isProcessing = true;
        console.log('WORKLET: Audio processing started');
      } else if (event.data.type === 'STOP') {
        this.isProcessing = false;
        console.log('WORKLET: Audio processing stopped');
      }
    };
  }
  
  process(inputs, outputs, parameters) {
    // Only process if we have input and processing is enabled
    if (!this.isProcessing || !inputs[0] || !inputs[0][0]) {
      return true;
    }
    
    const input = inputs[0];
    const inputData = input[0]; // Get first channel
    
    // Copy input to output (passthrough)
    if (outputs[0] && outputs[0][0]) {
      outputs[0][0].set(inputData);
    }
    
    if (inputData && inputData.length > 0) {
      // Add to buffer for processing
      for (let i = 0; i < inputData.length; i++) {
        this.buffer.push(inputData[i]);
      }
      
      // Process when we have enough data
      while (this.buffer.length >= this.bufferSize) {
        // Extract chunk
        const chunk = this.buffer.splice(0, this.bufferSize);
        
        // Convert Float32Array to Int16Array for AssemblyAI

        console.log("hi");
        const int16Array = new Int16Array(chunk.length);
        let maxAmplitude = 0;
        for (let i = 0; i < chunk.length; i++) {
          // Clamp and convert to 16-bit integer
          int16Array[i] = Math.max(-32768, Math.min(32767, chunk[i] * 32767));
          maxAmplitude = Math.max(maxAmplitude, Math.abs(int16Array[i]));
        }
        
        // Send audio data to main thread with amplitude info
        this.port.postMessage({
          type: 'AUDIO_DATA',
          data: int16Array,
          amplitude: maxAmplitude
        });
      }
    }
    
    return true; // Keep processor alive
  }
}

// Register the processor
registerProcessor('audio-processor', AudioProcessor);