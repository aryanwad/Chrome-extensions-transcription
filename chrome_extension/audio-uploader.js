// Chunked Audio Uploader for Large Audio Files
class ChunkedAudioUploader {
  constructor(backendUrl, userToken) {
    this.backendUrl = backendUrl;
    this.userToken = userToken;
    this.chunkSize = 7 * 1024 * 1024; // 7MB raw chunks (will be ~9.3MB base64, under 10MB limit)
    this.maxRetries = 3;
    this.timeout = 60000; // 60 second timeout per chunk for large uploads
  }

  async uploadAudioForTranscription(audioBuffer, metadata = {}) {
    try {
      console.log('🔄 Starting audio upload using presigned S3 URL pattern:', {
        audioSize: (audioBuffer.byteLength / 1024 / 1024).toFixed(2) + ' MB',
        metadata: metadata
      });
      
      try {
        // Try presigned S3 URL pattern first - industry standard for large file uploads
        console.log('🎯 Attempting presigned S3 URL upload...');
        return await this.uploadViaPresignedS3URL(audioBuffer, metadata);
      } catch (presignedError) {
        console.warn('⚠️ Presigned S3 upload failed, checking if we can fallback:', presignedError.message);
        
        // If the error is about missing endpoint (404) or auth issues (403), 
        // it means the backend doesn't have presigned URL support yet
        if (presignedError.message.includes('404') || presignedError.message.includes('403') || 
            presignedError.message.includes('Authorization') || presignedError.message.includes('Invalid key')) {
          
          console.log('🔄 Backend missing presigned URL support - using legacy upload method...');
          
          // Check if file is small enough for single chunk upload
          const singleChunkLimit = 6 * 1024 * 1024; // 6MB (well under 10MB API Gateway limit)
          
          if (audioBuffer.byteLength <= singleChunkLimit) {
            console.log('📤 File small enough for legacy single chunk upload');
            return await this.uploadSingleChunk(audioBuffer, metadata);
          } else {
            // File too large for legacy approach
            console.error('❌ File too large for legacy upload and backend lacks presigned URL support');
            throw new Error(`File too large (${(audioBuffer.byteLength / 1024 / 1024).toFixed(2)}MB) for upload. Backend needs presigned S3 URL support for files >6MB. Original error: ${presignedError.message}`);
          }
        } else {
          // Some other error, don't fallback
          throw presignedError;
        }
      }
      
    } catch (error) {
      console.error('❌ Audio upload failed:', error);
      throw error;
    }
  }
  
  async uploadViaPresignedS3URL(audioBuffer, metadata) {
    try {
      console.log('📤 Step 1: Requesting presigned S3 URL from backend...');
      
      // Step 1: Get presigned S3 URL from backend
      const presignedResponse = await this.makeRequest('/transcription/get-presigned-upload-url', 'POST', {
        file_size: audioBuffer.byteLength,
        content_type: 'audio/pcm',
        metadata: metadata
      });
      
      console.log('✅ Presigned URL received:', {
        hasUrl: !!presignedResponse.upload_url,
        hasKey: !!presignedResponse.s3_key,
        processingId: presignedResponse.processing_id
      });
      
      const { upload_url, s3_key, processing_id } = presignedResponse;
      
      console.log('📤 Step 2: Uploading audio directly to S3...');
      
      // Step 2: Upload raw PCM audio data directly to S3 using presigned URL
      const uploadStartTime = Date.now();
      
      const s3Response = await fetch(upload_url, {
        method: 'PUT',
        headers: {
          'Content-Type': 'audio/pcm'
        },
        body: audioBuffer // Raw PCM data, not base64!
      });
      
      const uploadTime = Date.now() - uploadStartTime;
      
      if (!s3Response.ok) {
        throw new Error(`S3 upload failed: ${s3Response.status} ${s3Response.statusText}`);
      }
      
      console.log('✅ S3 upload completed in', uploadTime + 'ms');
      
      console.log('📤 Step 3: Triggering backend processing...');
      
      // Step 3: Notify backend that upload is complete and trigger processing
      const processingResponse = await this.makeRequest('/transcription/process-s3-audio', 'POST', {
        processing_id: processing_id,
        s3_key: s3_key,
        metadata: metadata
      });
      
      console.log('🎉 Audio processing initiated successfully!');
      console.log('📊 Processing details:', {
        processingId: processing_id,
        s3Key: s3_key,
        hasResponse: !!processingResponse
      });
      
      return processingResponse;
      
    } catch (error) {
      console.error('❌ Presigned S3 upload failed:', error);
      throw error;
    }
  }

  async uploadSingleChunk(audioBuffer, metadata) {
    try {
      console.log('🔄 Starting single chunk upload...');
      console.log('📊 Audio buffer size:', (audioBuffer.byteLength / 1024 / 1024).toFixed(2) + ' MB');
      
      // Convert ArrayBuffer to base64 for JSON transport
      console.log('🔄 Converting audio to base64...');
      const startTime = Date.now();
      const base64Audio = this.arrayBufferToBase64(audioBuffer);
      const conversionTime = Date.now() - startTime;
      console.log('✅ Base64 conversion completed in', conversionTime + 'ms');
      console.log('📊 Base64 size:', (base64Audio.length / 1024 / 1024).toFixed(2) + ' MB');
      
      console.log('📤 Sending to /transcription/process-audio...');
      const response = await this.makeRequest('/transcription/process-audio', 'POST', {
        audio_data: base64Audio,
        format: 'pcm16',
        sample_rate: 16000,
        is_single_chunk: true,
        metadata: metadata
      });

      console.log('🎉 Single chunk upload completed successfully!');
      return response;
    } catch (error) {
      console.error('❌ Single chunk upload failed:', error);
      throw error;
    }
  }

  async uploadMultipleChunks(audioBuffer, totalChunks, metadata) {
    try {
      console.log('🔄 Initializing chunked upload session...');
      
      // Initialize upload session
      const sessionResponse = await this.makeRequest('/transcription/init-chunked-upload', 'POST', {
        total_size: audioBuffer.byteLength,
        total_chunks: totalChunks,
        format: 'pcm16',
        sample_rate: 16000,
        metadata: metadata
      });

      const uploadId = sessionResponse.upload_id;
      console.log('✅ Upload session initialized:', uploadId);
      console.log('📊 Session response details:', {
        hasUploadId: !!uploadId,
        uploadIdType: typeof uploadId,
        uploadIdLength: uploadId ? uploadId.length : 0,
        fullResponse: sessionResponse
      });

      // Add a small delay to ensure session is fully created
      console.log('⏳ Waiting 1 second for session to be fully initialized...');
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Upload chunks sequentially to avoid race conditions with session management
      console.log('📤 Starting chunk uploads (sequential to avoid race conditions)...');
      const uploadResults = await this.uploadChunksSequential(audioBuffer, uploadId, totalChunks);

      // Finalize upload
      console.log('🔄 Finalizing upload and starting transcription...');
      const finalResponse = await this.makeRequest('/transcription/finalize-chunked-upload', 'POST', {
        upload_id: uploadId,
        chunk_results: uploadResults
      });

      console.log('🎉 Transcription completed!');
      console.log('📝 Response preview:', {
        hasData: !!finalResponse.data,
        hasTranscript: !!finalResponse.transcript,
        hasSummary: !!finalResponse.summary,
        responseKeys: Object.keys(finalResponse)
      });
      
      return finalResponse;
    } catch (error) {
      console.error('❌ Multi-chunk upload failed:', error);
      throw error;
    }
  }

  async uploadChunksConcurrent(audioBuffer, uploadId, totalChunks, maxConcurrency = 3) {
    const results = [];
    const semaphore = new ChunkedUploadSemaphore(maxConcurrency);
    const promises = [];
    let completedChunks = 0;

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const promise = semaphore.acquire().then(async (release) => {
        try {
          const result = await this.uploadSingleChunkWithRetry(audioBuffer, uploadId, chunkIndex, totalChunks);
          completedChunks++;
          console.log(`✅ Chunk ${completedChunks}/${totalChunks} uploaded (${Math.round(completedChunks/totalChunks*100)}%)`);
          return result;
        } finally {
          release();
        }
      });
      promises.push(promise);
    }

    console.log(`⏳ Uploading ${totalChunks} chunks with max ${maxConcurrency} concurrent...`);
    const settledResults = await Promise.allSettled(promises);
    
    for (let i = 0; i < settledResults.length; i++) {
      const result = settledResults[i];
      if (result.status === 'fulfilled') {
        results.push({
          chunkIndex: i,
          success: true,
          etag: result.value.etag
        });
      } else {
        console.error(`❌ Chunk ${i} failed:`, result.reason.message);
        results.push({
          chunkIndex: i,
          success: false,
          error: result.reason.message
        });
      }
    }

    // Check if all chunks succeeded
    const failedChunks = results.filter(r => !r.success);
    if (failedChunks.length > 0) {
      console.error(`❌ ${failedChunks.length} chunks failed to upload`);
      throw new Error(`${failedChunks.length} chunks failed to upload`);
    }

    console.log(`✅ All ${totalChunks} chunks uploaded successfully`);
    return results;
  }

  async uploadChunksSequential(audioBuffer, uploadId, totalChunks) {
    const results = [];
    
    console.log(`🔄 Uploading ${totalChunks} chunks sequentially...`);
    
    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      try {
        console.log(`📦 Processing chunk ${chunkIndex + 1}/${totalChunks}...`);
        
        const result = await this.uploadSingleChunkWithRetry(audioBuffer, uploadId, chunkIndex, totalChunks);
        
        results.push({
          chunkIndex: chunkIndex,
          success: true,
          etag: result.etag
        });
        
        console.log(`✅ Chunk ${chunkIndex + 1}/${totalChunks} completed successfully`);
        
        // Small delay between chunks to be gentle on the backend
        if (chunkIndex < totalChunks - 1) {
          await new Promise(resolve => setTimeout(resolve, 500));
        }
        
      } catch (error) {
        console.error(`❌ Chunk ${chunkIndex + 1} failed permanently:`, error.message);
        results.push({
          chunkIndex: chunkIndex,
          success: false,
          error: error.message
        });
      }
    }
    
    // Check if all chunks succeeded
    const failedChunks = results.filter(r => !r.success);
    if (failedChunks.length > 0) {
      console.error(`❌ ${failedChunks.length} chunks failed to upload`);
      throw new Error(`${failedChunks.length} chunks failed to upload`);
    }

    console.log(`✅ All ${totalChunks} chunks uploaded successfully (sequential)`);
    return results;
  }

  async uploadMultipleSingleChunks(audioBuffer, totalChunks, metadata) {
    try {
      console.log('🔄 Processing large file as multiple single uploads...');
      console.log('📊 Will process as', totalChunks, 'separate uploads');
      
      const uploadResults = [];
      
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        console.log(`📦 Processing chunk ${chunkIndex + 1}/${totalChunks} as single upload...`);
        
        // Extract the chunk
        const startByte = chunkIndex * this.chunkSize;
        const endByte = Math.min(startByte + this.chunkSize, audioBuffer.byteLength);
        const chunkBuffer = audioBuffer.slice(startByte, endByte);
        
        console.log(`📊 Chunk ${chunkIndex + 1} size: ${(chunkBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
        
        // Create metadata for this chunk
        const chunkMetadata = {
          ...metadata,
          chunk_index: chunkIndex,
          total_chunks: totalChunks,
          chunk_size: chunkBuffer.byteLength,
          is_multi_part: true
        };
        
        try {
          // Upload this chunk as a single upload
          const result = await this.uploadSingleChunk(chunkBuffer, chunkMetadata);
          uploadResults.push({
            chunkIndex: chunkIndex,
            result: result,
            success: true
          });
          
          console.log(`✅ Chunk ${chunkIndex + 1}/${totalChunks} uploaded successfully`);
          
          // Small delay between uploads
          if (chunkIndex < totalChunks - 1) {
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
          
        } catch (error) {
          console.error(`❌ Chunk ${chunkIndex + 1} failed:`, error.message);
          uploadResults.push({
            chunkIndex: chunkIndex,
            result: null,
            success: false,
            error: error.message
          });
        }
      }
      
      // Check results
      const successfulChunks = uploadResults.filter(r => r.success);
      const failedChunks = uploadResults.filter(r => !r.success);
      
      if (failedChunks.length > 0) {
        console.error(`❌ ${failedChunks.length} chunks failed out of ${totalChunks}`);
        throw new Error(`${failedChunks.length} chunks failed to upload`);
      }
      
      console.log(`✅ All ${totalChunks} chunks uploaded successfully as individual uploads`);
      
      // Combine results from all chunks
      const combinedTranscript = successfulChunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map(chunk => chunk.result.transcript || '')
        .join(' ');
      
      const combinedSummary = successfulChunks
        .sort((a, b) => a.chunkIndex - b.chunkIndex)
        .map(chunk => chunk.result.summary || '')
        .filter(summary => summary.length > 0)
        .join('\n\n');
      
      console.log('🎉 Combined results from all chunks!');
      
      return {
        success: true,
        transcript: combinedTranscript,
        summary: combinedSummary,
        processing_method: 'multiple_single_uploads',
        chunks_processed: successfulChunks.length
      };
      
    } catch (error) {
      console.error('❌ Multiple single uploads failed:', error);
      throw error;
    }
  }

  async uploadSingleChunkWithRetry(audioBuffer, uploadId, chunkIndex, totalChunks, retryCount = 0) {
    try {
      const startByte = chunkIndex * this.chunkSize;
      const endByte = Math.min(startByte + this.chunkSize, audioBuffer.byteLength);
      const chunkBuffer = audioBuffer.slice(startByte, endByte);
      
      console.log(`📦 Preparing chunk ${chunkIndex + 1}/${totalChunks}: ${(chunkBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
      
      const startTime = Date.now();
      console.log(`🔄 Converting chunk ${chunkIndex + 1} to base64...`);
      const base64Chunk = this.arrayBufferToBase64(chunkBuffer);
      const conversionTime = Date.now() - startTime;
      console.log(`✅ Chunk ${chunkIndex + 1} base64 conversion completed in ${conversionTime}ms`);
      
      console.log(`📤 Uploading chunk ${chunkIndex + 1}/${totalChunks} to AWS...`);
      const uploadStartTime = Date.now();
      
      const response = await this.makeRequest('/transcription/upload-chunk', 'POST', {
        upload_id: uploadId,
        chunk_index: chunkIndex,
        chunk_data: base64Chunk,
        chunk_size: chunkBuffer.byteLength
      });

      const uploadTime = Date.now() - uploadStartTime;
      console.log(`✅ Chunk ${chunkIndex + 1} uploaded successfully in ${uploadTime}ms`);
      console.log(`🎯 Chunk ${chunkIndex + 1} response:`, { success: !!response, etag: response.etag });
      
      return response;
    } catch (error) {
      console.error(`❌ Chunk ${chunkIndex + 1} upload failed (attempt ${retryCount + 1}/${this.maxRetries + 1}):`, error.message);
      
      if (retryCount < this.maxRetries) {
        const retryDelay = 1000 * (retryCount + 1);
        console.log(`⏳ Retrying chunk ${chunkIndex + 1} in ${retryDelay}ms...`);
        await this.delay(retryDelay); // Exponential backoff
        return this.uploadSingleChunkWithRetry(audioBuffer, uploadId, chunkIndex, totalChunks, retryCount + 1);
      }
      
      console.error(`💀 Chunk ${chunkIndex + 1} failed permanently after ${this.maxRetries} retries`);
      throw error;
    }
  }

  async makeRequest(endpoint, method, data) {
    const url = `${this.backendUrl}${endpoint}`;
    
    console.log(`🌐 Making ${method} request to: ${endpoint}`);
    console.log(`📊 Request payload size: ${JSON.stringify(data).length} characters`);
    console.log(`⏱️  Request timeout: ${this.timeout}ms`);
    console.log(`🔑 User token preview: ${this.userToken ? this.userToken.substring(0, 20) + '...' : 'MISSING'}`);
    
    // Validate token format
    if (!this.userToken) {
      throw new Error('No authentication token available');
    }
    
    // Ensure token doesn't have Bearer prefix already
    const cleanToken = this.userToken.startsWith('Bearer ') ? this.userToken.substring(7) : this.userToken;
    console.log(`🔍 Clean token preview: ${cleanToken.substring(0, 20)}...`);
    
    try {
      const requestStartTime = Date.now();
      
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${cleanToken}`
        },
        body: JSON.stringify(data),
        signal: AbortSignal.timeout(this.timeout)
      });

      const requestTime = Date.now() - requestStartTime;
      console.log(`📨 Response received in ${requestTime}ms - Status: ${response.status} ${response.statusText}`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error(`❌ HTTP Error ${response.status}:`, errorData);
        console.error(`🔍 Full error response:`, {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          errorData: errorData
        });
        throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
      }

      const responseData = await response.json();
      console.log(`✅ Request completed successfully:`, { 
        endpoint: endpoint, 
        responseKeys: Object.keys(responseData),
        hasData: !!responseData 
      });
      
      return responseData;
      
    } catch (error) {
      console.error(`💥 Request failed for ${endpoint}:`, error);
      if (error.name === 'TimeoutError') {
        console.error(`⏰ Request timed out after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  arrayBufferToBase64(buffer) {
    // Convert ArrayBuffer to base64 string
    const uint8Array = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 8192;
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, i + chunkSize);
      binary += String.fromCharCode.apply(null, chunk);
    }
    
    return btoa(binary);
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Simple semaphore for upload concurrency control
class ChunkedUploadSemaphore {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
  }

  async acquire() {
    return new Promise((resolve) => {
      if (this.running < this.maxConcurrent) {
        this.running++;
        resolve(() => {
          this.running--;
          if (this.queue.length > 0) {
            const next = this.queue.shift();
            next();
          }
        });
      } else {
        this.queue.push(() => {
          this.running++;
          resolve(() => {
            this.running--;
            if (this.queue.length > 0) {
              const next = this.queue.shift();
              next();
            }
          });
        });
      }
    });
  }
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkedAudioUploader;
} else if (typeof window !== 'undefined') {
  window.ChunkedAudioUploader = ChunkedAudioUploader;
} else {
  // Service worker context - attach to global scope
  self.ChunkedAudioUploader = ChunkedAudioUploader;
}