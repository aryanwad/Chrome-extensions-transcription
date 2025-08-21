// M3U8 Video Downloader for Chrome Extension Service Worker
class M3U8Downloader {
  constructor() {
    this.maxConcurrentDownloads = 6;
    this.segmentTimeoutMs = 10000;
    this.retryAttempts = 3;
  }

  async parseM3U8Playlist(m3u8Url) {
    try {
      // Remove debug logging
      
      const response = await fetch(m3u8Url);
      if (!response.ok) {
        throw new Error(`Failed to fetch m3u8: ${response.status}`);
      }

      const content = await response.text();
      const segments = this.extractSegments(content, m3u8Url);
      
      // Remove debug logging
      return segments;
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  extractSegments(m3u8Content, baseUrl) {
    const lines = m3u8Content.split('\n').map(line => line.trim());
    const segments = [];
    let currentDuration = 0;
    let sequenceNumber = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Extract segment duration
      if (line.startsWith('#EXTINF:')) {
        const durationMatch = line.match(/^#EXTINF:([0-9.]+)/);
        if (durationMatch) {
          currentDuration = parseFloat(durationMatch[1]);
        }
        continue;
      }

      // Skip other metadata lines
      if (line.startsWith('#')) {
        continue;
      }

      // This should be a segment URL
      if (line && !line.startsWith('#')) {
        let segmentUrl = line;
        
        // Convert relative URLs to absolute
        if (!segmentUrl.startsWith('http')) {
          const baseUrlParts = baseUrl.split('/');
          baseUrlParts.pop(); // Remove filename
          segmentUrl = baseUrlParts.join('/') + '/' + segmentUrl;
        }

        segments.push({
          url: segmentUrl,
          duration: currentDuration,
          sequence: sequenceNumber++
        });

        currentDuration = 0; // Reset for next segment
      }
    }

    return segments;
  }

  calculateSegmentsForDuration(segments, durationMinutes) {
    // Calculate which segments to download based on duration
    const targetDurationSeconds = durationMinutes * 60;
    const totalDuration = segments.reduce((sum, seg) => sum + seg.duration, 0);
    
    if (targetDurationSeconds >= totalDuration) {
      // Return all segments if requested duration is longer than total
      // Remove debug logging
      return segments;
    }

    // Take segments from the end (most recent)
    let accumulatedDuration = 0;
    const selectedSegments = [];
    
    for (let i = segments.length - 1; i >= 0 && accumulatedDuration < targetDurationSeconds; i--) {
      selectedSegments.unshift(segments[i]);
      accumulatedDuration += segments[i].duration;
    }

    // Remove debug logging
    return selectedSegments;
  }

  async downloadSegment(segment, retryCount = 0) {
    try {
      // Remove debug logging
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.segmentTimeoutMs);

      const response = await fetch(segment.url, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const buffer = await response.arrayBuffer();
      // Remove debug logging

      return {
        sequence: segment.sequence,
        data: buffer,
        duration: segment.duration
      };
    } catch (error) {
      // Remove debug logging
      
      if (retryCount < this.retryAttempts) {
        // Remove debug logging
        await this.delay(1000 * (retryCount + 1)); // Exponential backoff
        return this.downloadSegment(segment, retryCount + 1);
      }

      throw new Error(`Segment ${segment.sequence} failed after ${this.retryAttempts} retries: ${error.message}`);
    }
  }

  async downloadSegmentsConcurrent(segments, onProgress = null) {
    // Remove debug logging
    
    const results = [];
    const errors = [];
    let completed = 0;

    // Create download promises with concurrency limit
    const downloadPromises = [];
    const semaphore = new Semaphore(this.maxConcurrentDownloads);

    for (const segment of segments) {
      const promise = semaphore.acquire().then(async (release) => {
        try {
          const result = await this.downloadSegment(segment);
          completed++;
          
          if (onProgress) {
            onProgress({
              completed,
              total: segments.length,
              percentage: Math.round((completed / segments.length) * 100)
            });
          }
          
          return result;
        } finally {
          release();
        }
      });

      downloadPromises.push(promise);
    }

    // Wait for all downloads to complete
    const settledResults = await Promise.allSettled(downloadPromises);
    
    for (let i = 0; i < settledResults.length; i++) {
      const result = settledResults[i];
      if (result.status === 'fulfilled') {
        results.push(result.value);
      } else {
        errors.push({
          segment: segments[i],
          error: result.reason
        });
      }
    }

    // Remove debug logging

    if (errors.length > 0) {
      // Remove debug logging
    }

    // Sort by sequence number to maintain order
    results.sort((a, b) => a.sequence - b.sequence);

    return results;
  }

  async concatenateSegments(segmentData) {
    // Remove debug logging

    // Calculate total size
    const totalSize = segmentData.reduce((sum, seg) => sum + seg.data.byteLength, 0);
    // Remove debug logging

    // Create concatenated buffer
    const concatenated = new Uint8Array(totalSize);
    let offset = 0;

    for (const segment of segmentData) {
      concatenated.set(new Uint8Array(segment.data), offset);
      offset += segment.data.byteLength;
    }

    // Remove debug logging
    return concatenated.buffer;
  }

  async downloadM3U8Video(m3u8Url, durationMinutes, onProgress = null) {
    try {
      // Remove debug logging

      // Parse playlist
      if (onProgress) onProgress({ stage: 'parsing', message: 'Parsing m3u8 playlist...' });
      const allSegments = await this.parseM3U8Playlist(m3u8Url);

      // Select segments for requested duration
      const segments = this.calculateSegmentsForDuration(allSegments, durationMinutes);
      
      if (segments.length === 0) {
        throw new Error('No segments found for the requested duration');
      }

      // Download segments
      if (onProgress) onProgress({ stage: 'downloading', message: `Downloading ${segments.length} segments...` });
      
      const segmentData = await this.downloadSegmentsConcurrent(segments, (progress) => {
        if (onProgress) {
          onProgress({
            stage: 'downloading',
            message: `Downloading segments... ${progress.completed}/${progress.total} (${progress.percentage}%)`,
            percentage: progress.percentage
          });
        }
      });

      // Concatenate segments
      if (onProgress) onProgress({ stage: 'concatenating', message: 'Combining video segments...' });
      const videoBuffer = await this.concatenateSegments(segmentData);

      // Remove debug logging
      
      return {
        buffer: videoBuffer,
        totalDuration: segmentData.reduce((sum, seg) => sum + seg.duration, 0),
        segmentCount: segmentData.length,
        totalSize: videoBuffer.byteLength
      };
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Simple semaphore implementation for concurrency control
class Semaphore {
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
  module.exports = M3U8Downloader;
} else if (typeof window !== 'undefined') {
  window.M3U8Downloader = M3U8Downloader;
} else {
  // Service worker context - attach to global scope
  self.M3U8Downloader = M3U8Downloader;
}