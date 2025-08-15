#!/usr/bin/env python3
"""
Chrome Native Messaging Host for Live Transcription
Handles local audio processing when serverless fails
"""

import sys
import json
import struct
import subprocess
import tempfile
import os
import requests
import time
from pathlib import Path
import logging

# Set up debug logging to a file
logging.basicConfig(
    filename='/tmp/native_messaging_debug.log',
    level=logging.DEBUG,
    format='%(asctime)s [%(levelname)s] %(message)s'
)
logger = logging.getLogger(__name__)

# API Keys - same as serverless version
ASSEMBLYAI_API_KEY = "d075180583e743dc84435b50f422373b"
OPENAI_API_KEY = "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"

def send_message(message):
    """Send message to Chrome extension"""
    message_json = json.dumps(message)
    message_length = len(message_json.encode('utf-8'))
    
    # Write message length (4 bytes, little endian)
    sys.stdout.buffer.write(struct.pack('<I', message_length))
    # Write message content
    sys.stdout.buffer.write(message_json.encode('utf-8'))
    sys.stdout.buffer.flush()

def read_message():
    """Read message from Chrome extension"""
    try:
        # Read message length (4 bytes)
        raw_length = sys.stdin.buffer.read(4)
        if not raw_length or len(raw_length) != 4:
            logger.info("📭 No length header received or incomplete (connection ended)")
            return None
        
        message_length = struct.unpack('<I', raw_length)[0]
        logger.info(f"📏 Expected message length: {message_length} bytes")
        
        if message_length == 0:
            logger.warning("⚠️ Zero-length message received")
            return None
            
        if message_length > 1024 * 1024:  # 1MB limit
            logger.error(f"❌ Message too large: {message_length} bytes")
            return None
        
        # Read message content
        message = sys.stdin.buffer.read(message_length).decode('utf-8')
        logger.info(f"📨 Raw message received: {message[:200]}{'...' if len(message) > 200 else ''}")
        
        if not message.strip():
            logger.warning("⚠️ Empty message content received")
            return None
            
        parsed_message = json.loads(message)
        logger.info(f"✅ Successfully parsed JSON message")
        return parsed_message
        
    except struct.error as e:
        logger.error(f"❌ Failed to unpack message length: {e}")
        return None
    except json.JSONDecodeError as e:
        logger.error(f"❌ Failed to parse JSON: {e}")
        logger.error(f"❌ Raw message content: {repr(message) if 'message' in locals() else 'N/A'}")
        return None
    except UnicodeDecodeError as e:
        logger.error(f"❌ Failed to decode message as UTF-8: {e}")
        return None
    except Exception as e:
        logger.error(f"💥 Unexpected error reading message: {e}")
        return None

def download_vod_audio(vod_url, duration_minutes, progress_callback=None):
    """Download VOD audio using local yt-dlp"""
    logger.info(f"🎵 Starting VOD audio download: {vod_url}")
    
    try:
        temp_dir = tempfile.mkdtemp()
        output_file = os.path.join(temp_dir, "catchup_audio")
        logger.info(f"📁 Created temp directory: {temp_dir}")
        
        # Calculate section parameters
        duration_seconds = duration_minutes * 60
        slice_option = f"*-{duration_seconds}-inf"
        logger.info(f"⏰ Downloading last {duration_minutes} minutes ({duration_seconds}s) with slice: {slice_option}")
        
        if progress_callback:
            progress_callback({"stage": "downloading", "progress": 10, "message": f"Downloading last {duration_minutes} minutes..."})
        
        # Build yt-dlp command
        cmd = [
            sys.executable, "-m", "yt_dlp",
            "-f", "bestaudio",
            "--extract-audio", "--audio-format", "mp3",
            "--download-sections", slice_option,
            "-o", output_file + ".%(ext)s",
            "--no-warnings",
            vod_url
        ]
        
        logger.info(f"🔧 yt-dlp command: {' '.join(cmd)}")
        
        # Execute download
        logger.info("⬇️ Starting yt-dlp download...")
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        logger.info(f"✅ yt-dlp completed with return code: {result.returncode}")
        logger.info(f"📝 yt-dlp stdout: {result.stdout}")
        if result.stderr:
            logger.info(f"⚠️ yt-dlp stderr: {result.stderr}")
        
        if result.returncode == 0:
            # Find MP3 file
            files_in_temp = os.listdir(temp_dir)
            logger.info(f"📂 Files in temp directory: {files_in_temp}")
            
            for file in files_in_temp:
                if file.startswith("catchup_audio") and file.endswith('.mp3'):
                    mp3_path = os.path.join(temp_dir, file)
                    file_size = os.path.getsize(mp3_path)
                    
                    logger.info(f"🎵 Found MP3 file: {file} ({file_size/1024/1024:.1f}MB)")
                    
                    if progress_callback:
                        progress_callback({"stage": "downloaded", "progress": 30, "message": f"Downloaded {file_size/1024/1024:.1f}MB audio file"})
                    
                    return mp3_path, temp_dir
            
            logger.error("❌ No MP3 file found after successful yt-dlp execution")
        else:
            logger.error(f"❌ yt-dlp failed with return code {result.returncode}")
        
        return None, None
        
    except Exception as e:
        logger.error(f"💥 Download exception: {str(e)}")
        if progress_callback:
            progress_callback({"stage": "error", "progress": 0, "message": f"Download failed: {str(e)}"})
        return None, None

def transcribe_audio(audio_file, progress_callback=None):
    """Transcribe audio using AssemblyAI"""
    try:
        if progress_callback:
            progress_callback({"stage": "uploading", "progress": 40, "message": "Uploading audio for transcription..."})
        
        # Upload file
        with open(audio_file, 'rb') as f:
            upload_response = requests.post(
                'https://api.assemblyai.com/v2/upload',
                files={'file': f},
                headers={'authorization': ASSEMBLYAI_API_KEY},
                timeout=60
            )
        
        if upload_response.status_code != 200:
            return None
        
        audio_url = upload_response.json()['upload_url']
        
        if progress_callback:
            progress_callback({"stage": "transcribing", "progress": 50, "message": "Starting transcription..."})
        
        # Start transcription
        transcript_response = requests.post(
            'https://api.assemblyai.com/v2/transcript',
            json={'audio_url': audio_url},
            headers={'authorization': ASSEMBLYAI_API_KEY}
        )
        
        if transcript_response.status_code != 200:
            return None
        
        transcript_id = transcript_response.json()['id']
        
        # Poll for completion
        for i in range(120):  # 10 minutes max
            status_response = requests.get(
                f'https://api.assemblyai.com/v2/transcript/{transcript_id}',
                headers={'authorization': ASSEMBLYAI_API_KEY}
            )
            
            if status_response.status_code == 200:
                status_data = status_response.json()
                
                if status_data['status'] == 'completed':
                    if progress_callback:
                        progress_callback({"stage": "transcribed", "progress": 80, "message": "Transcription complete!"})
                    return status_data['text']
                elif status_data['status'] == 'error':
                    return None
                else:
                    # Update progress
                    progress = min(50 + (i * 0.25), 75)
                    if progress_callback:
                        progress_callback({"stage": "transcribing", "progress": progress, "message": f"Transcribing... ({i*5}s elapsed)"})
            
            time.sleep(5)
        
        return None
        
    except Exception as e:
        if progress_callback:
            progress_callback({"stage": "error", "progress": 0, "message": f"Transcription failed: {str(e)}"})
        return None

def generate_summary(transcript, duration_minutes, stream_url, progress_callback=None):
    """Generate AI summary using OpenAI"""
    try:
        if progress_callback:
            progress_callback({"stage": "summarizing", "progress": 90, "message": "Generating AI summary..."})
        
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Content-Type': 'application/json',
                'Authorization': f'Bearer {OPENAI_API_KEY}'
            },
            json={
                'model': 'gpt-4',
                'messages': [
                    {
                        'role': 'system',
                        'content': 'Create a concise, engaging summary of this stream transcript. Focus on key moments, interesting content, and notable events. Include timestamps if available.'
                    },
                    {
                        'role': 'user',
                        'content': f'Summarize the last {duration_minutes} minutes of this livestream from {stream_url}:\n\n{transcript}'
                    }
                ],
                'max_tokens': 500,
                'temperature': 0.7
            },
            timeout=30
        )
        
        if response.status_code == 200:
            summary = response.json()['choices'][0]['message']['content']
            
            formatted_summary = f"""🎮 **Local Catch-Up Success!** ({duration_minutes} minutes)

{summary}

**📊 Processing Details:**
• Source: {stream_url}
• Method: Local audio download + AI analysis
• Transcript length: {len(transcript)} characters
• Processing: Complete ⚡

**🏠 Powered by Native Messaging**
*Seamless local processing with full audio access*"""
            
            return formatted_summary
        else:
            return f"AI Summary generation failed: {response.status_code}"
            
    except Exception as e:
        return f"Summary error: {str(e)}"

def process_catchup_request(request):
    """Main catch-up processing function"""
    vod_url = request.get('vod_url')
    duration_minutes = request.get('duration_minutes', 30)
    stream_url = request.get('stream_url', vod_url)
    
    logger.info(f"🎬 Processing catch-up request:")
    logger.info(f"   📺 VOD URL: {vod_url}")
    logger.info(f"   ⏱️ Duration: {duration_minutes} minutes")
    logger.info(f"   🌐 Stream URL: {stream_url}")
    
    def send_progress(progress_data):
        logger.info(f"📊 Progress: {progress_data}")
        send_message({
            "type": "progress",
            "data": progress_data
        })
    
    try:
        # Step 1: Download audio
        logger.info("🎵 Step 1: Starting audio download...")
        send_progress({"stage": "starting", "progress": 5, "message": "Starting local audio download..."})
        
        audio_file, temp_dir = download_vod_audio(vod_url, duration_minutes, send_progress)
        
        if not audio_file:
            error_msg = "Failed to download audio locally. Check if yt-dlp is installed."
            logger.error(f"❌ {error_msg}")
            send_message({
                "type": "error",
                "error": error_msg
            })
            return
        
        logger.info(f"✅ Audio download successful: {audio_file}")
        
        # Step 2: Transcribe
        logger.info("🎤 Step 2: Starting transcription...")
        transcript = transcribe_audio(audio_file, send_progress)
        
        if not transcript:
            error_msg = "Failed to transcribe audio. Check AssemblyAI API key."
            logger.error(f"❌ {error_msg}")
            send_message({
                "type": "error", 
                "error": error_msg
            })
            return
        
        logger.info(f"✅ Transcription successful: {len(transcript)} characters")
        
        # Step 3: Generate summary
        logger.info("🤖 Step 3: Generating AI summary...")
        summary = generate_summary(transcript, duration_minutes, stream_url, send_progress)
        
        # Step 4: Send complete result
        logger.info("🎉 Step 4: Sending complete result...")
        send_progress({"stage": "complete", "progress": 100, "message": "Local catch-up complete!"})
        
        result_data = {
            "summary": summary,
            "fullTranscript": transcript,
            "duration": duration_minutes,
            "streamUrl": stream_url,
            "method": "native_messaging_success",
            "processingTime": "Local native processing"
        }
        
        send_message({
            "type": "complete",
            "data": result_data
        })
        
        logger.info("✅ Complete result sent to Chrome extension")
        
        # Cleanup
        logger.info("🧹 Cleaning up temporary files...")
        try:
            if audio_file and os.path.exists(audio_file):
                os.remove(audio_file)
                logger.info(f"🗑️ Deleted audio file: {audio_file}")
            if temp_dir and os.path.exists(temp_dir):
                os.rmdir(temp_dir)
                logger.info(f"🗑️ Deleted temp directory: {temp_dir}")
        except Exception as cleanup_error:
            logger.warning(f"⚠️ Cleanup failed: {cleanup_error}")
            
    except Exception as e:
        error_msg = f"Native messaging processing failed: {str(e)}"
        logger.error(f"💥 Fatal processing error: {error_msg}")
        send_message({
            "type": "error",
            "error": error_msg
        })

def main():
    """Main native messaging loop"""
    logger.info("🚀 Native messaging host starting...")
    
    try:
        # Log startup info
        logger.info(f"Python version: {sys.version}")
        logger.info(f"Working directory: {os.getcwd()}")
        logger.info(f"Python path: {sys.executable}")
        
        while True:
            logger.info("📨 Waiting for message from Chrome extension...")
            
            # Read message from extension
            message = read_message()
            
            if message is None:
                logger.info("📪 No message received, ending connection")
                break
            
            logger.info(f"📨 Received message: {json.dumps(message, indent=2)}")
            
            # Send acknowledgment
            ack_msg = {
                "type": "ack",
                "message": "Native host received request successfully!"
            }
            send_message(ack_msg)
            logger.info(f"✅ Sent acknowledgment: {ack_msg}")
            
            # Process catch-up request
            if message.get('type') == 'catchup':
                logger.info("🎯 Processing catch-up request...")
                data = message.get('data', {})
                logger.info(f"🔍 Request data: VOD URL={data.get('vod_url')}, Duration={data.get('duration_minutes')}min")
                process_catchup_request(data)
            else:
                error_msg = f"Unknown message type: {message.get('type')}"
                logger.error(f"❌ {error_msg}")
                send_message({
                    "type": "error",
                    "error": error_msg
                })
                
    except KeyboardInterrupt:
        logger.info("🛑 Received keyboard interrupt, shutting down")
    except Exception as e:
        logger.error(f"💥 Fatal error: {str(e)}")
        send_message({
            "type": "error",
            "error": f"Native host error: {str(e)}"
        })
    
    logger.info("🏁 Native messaging host shutting down")

if __name__ == "__main__":
    main()