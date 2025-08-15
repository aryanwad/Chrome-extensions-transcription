// Transcript Storage Module for Chrome Extension
// Stores real-time transcripts for later "catch-up" summaries

class TranscriptStorage {
    constructor() {
        this.storage_key = 'live_transcripts';
        this.max_storage_hours = 2; // Keep last 2 hours
        this.cleanup_interval = 5 * 60 * 1000; // Clean up every 5 minutes
        this.current_stream = null;
        
        this.startCleanupTimer();
    }
    
    async startTranscriptSession(streamUrl, streamTitle = "Unknown Stream") {
        /**
         * Start a new transcript session for a stream
         */
        const session_id = this.generateSessionId(streamUrl);
        
        this.current_stream = {
            session_id: session_id,
            stream_url: streamUrl,
            stream_title: streamTitle,
            started_at: Date.now(),
            transcripts: []
        };
        
        console.log('📝 Started transcript session:', session_id);
        return session_id;
    }
    
    async addTranscript(text, isFinal = false) {
        /**
         * Add a transcript segment to the current session
         */
        if (!this.current_stream) {
            console.warn('⚠️ No active transcript session');
            return;
        }
        
        const transcript_entry = {
            timestamp: Date.now(),
            text: text.trim(),
            is_final: isFinal,
            duration_from_start: Date.now() - this.current_stream.started_at
        };
        
        this.current_stream.transcripts.push(transcript_entry);
        
        // Save to storage periodically (every 10 final transcripts)
        const final_count = this.current_stream.transcripts.filter(t => t.is_final).length;
        if (final_count % 10 === 0 && isFinal) {
            await this.saveCurrentSession();
            console.log(`💾 Auto-saved transcript session (${final_count} final transcripts)`);
        }
    }
    
    async saveCurrentSession() {
        /**
         * Save the current session to Chrome storage
         */
        if (!this.current_stream) return;
        
        try {
            const stored_data = await this.getStoredTranscripts();
            
            // Update or add current session
            const session_index = stored_data.sessions.findIndex(
                s => s.session_id === this.current_stream.session_id
            );
            
            if (session_index >= 0) {
                stored_data.sessions[session_index] = this.current_stream;
            } else {
                stored_data.sessions.push(this.current_stream);
            }
            
            await chrome.storage.local.set({ [this.storage_key]: stored_data });
            console.log(`💾 Saved session ${this.current_stream.session_id}`);
            
        } catch (error) {
            console.error('❌ Failed to save transcript session:', error);
        }
    }
    
    async stopTranscriptSession() {
        /**
         * Stop the current session and save final state
         */
        if (!this.current_stream) return;
        
        this.current_stream.ended_at = Date.now();
        this.current_stream.total_duration = this.current_stream.ended_at - this.current_stream.started_at;
        
        await this.saveCurrentSession();
        
        console.log(`✅ Stopped transcript session: ${this.current_stream.session_id}`);
        console.log(`   Duration: ${this.current_stream.total_duration / 1000 / 60:.1f} minutes`);
        console.log(`   Final transcripts: ${this.current_stream.transcripts.filter(t => t.is_final).length}`);
        
        this.current_stream = null;
    }
    
    async getCatchupSummary(streamUrl, durationMinutes) {
        /**
         * Get transcript data for the last N minutes for AI summarization
         */
        try {
            const stored_data = await this.getStoredTranscripts();
            const session = this.findRecentSession(stored_data.sessions, streamUrl);
            
            if (!session) {
                return {
                    error: "No recent transcript data found for this stream. Start live transcription first to enable catch-up summaries."
                };
            }
            
            // Get transcripts from the last N minutes
            const cutoff_time = Date.now() - (durationMinutes * 60 * 1000);
            const recent_transcripts = session.transcripts.filter(t => 
                t.is_final && t.timestamp >= cutoff_time
            );
            
            if (recent_transcripts.length === 0) {
                return {
                    error: `No transcript data found for the last ${durationMinutes} minutes. The stream may not have been active during this period.`
                };
            }
            
            // Combine transcripts into full text
            const full_text = recent_transcripts
                .map(t => t.text)
                .join(' ')
                .trim();
            
            const summary_data = {
                stream_url: streamUrl,
                stream_title: session.stream_title,
                duration_minutes: durationMinutes,
                transcript_segments: recent_transcripts.length,
                full_transcript: full_text,
                time_range: {
                    start: new Date(recent_transcripts[0].timestamp).toISOString(),
                    end: new Date(recent_transcripts[recent_transcripts.length - 1].timestamp).toISOString()
                },
                session_info: {
                    session_id: session.session_id,
                    started_at: new Date(session.started_at).toISOString(),
                    total_transcripts: session.transcripts.length
                }
            };
            
            console.log(`📊 Catch-up summary prepared:`, summary_data);
            return summary_data;
            
        } catch (error) {
            console.error('❌ Failed to get catch-up summary:', error);
            return {
                error: `Failed to retrieve transcript data: ${error.message}`
            };
        }
    }
    
    async getStoredTranscripts() {
        /**
         * Get all stored transcript sessions
         */
        try {
            const result = await chrome.storage.local.get([this.storage_key]);
            return result[this.storage_key] || { sessions: [] };
        } catch (error) {
            console.error('❌ Failed to get stored transcripts:', error);
            return { sessions: [] };
        }
    }
    
    findRecentSession(sessions, streamUrl) {
        /**
         * Find the most recent session for a stream URL
         */
        const matching_sessions = sessions.filter(s => 
            s.stream_url === streamUrl || s.stream_url.includes(streamUrl) || streamUrl.includes(s.stream_url)
        );
        
        if (matching_sessions.length === 0) return null;
        
        // Return most recent session
        return matching_sessions.sort((a, b) => b.started_at - a.started_at)[0];
    }
    
    generateSessionId(streamUrl) {
        /**
         * Generate unique session ID
         */
        const url_hash = streamUrl.split('/').pop() || 'unknown';
        const timestamp = Date.now();
        return `${url_hash}_${timestamp}`;
    }
    
    startCleanupTimer() {
        /**
         * Periodically clean up old transcript data
         */
        setInterval(async () => {
            await this.cleanupOldTranscripts();
        }, this.cleanup_interval);
    }
    
    async cleanupOldTranscripts() {
        /**
         * Remove transcript sessions older than max_storage_hours
         */
        try {
            const stored_data = await this.getStoredTranscripts();
            const cutoff_time = Date.now() - (this.max_storage_hours * 60 * 60 * 1000);
            
            const sessions_before = stored_data.sessions.length;
            stored_data.sessions = stored_data.sessions.filter(s => s.started_at > cutoff_time);
            const sessions_after = stored_data.sessions.length;
            
            if (sessions_before !== sessions_after) {
                await chrome.storage.local.set({ [this.storage_key]: stored_data });
                console.log(`🧹 Cleaned up ${sessions_before - sessions_after} old transcript sessions`);
            }
            
        } catch (error) {
            console.error('❌ Failed to cleanup old transcripts:', error);
        }
    }
    
    async getStorageStats() {
        /**
         * Get statistics about stored transcript data
         */
        try {
            const stored_data = await this.getStoredTranscripts();
            const total_transcripts = stored_data.sessions.reduce((sum, s) => sum + s.transcripts.length, 0);
            const storage_size = JSON.stringify(stored_data).length;
            
            return {
                sessions: stored_data.sessions.length,
                total_transcripts: total_transcripts,
                storage_size_kb: (storage_size / 1024).toFixed(1),
                oldest_session: stored_data.sessions.length > 0 ? 
                    new Date(Math.min(...stored_data.sessions.map(s => s.started_at))).toISOString() : null,
                newest_session: stored_data.sessions.length > 0 ? 
                    new Date(Math.max(...stored_data.sessions.map(s => s.started_at))).toISOString() : null
            };
        } catch (error) {
            return { error: error.message };
        }
    }
}

// Global instance
const transcriptStorage = new TranscriptStorage();

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = TranscriptStorage;
}