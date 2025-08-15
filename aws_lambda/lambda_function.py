#!/usr/bin/env python3
"""
AWS Lambda function for Live Transcription Catch-Up
Same logic as Vercel but with AWS Lambda's massive IP pool
"""

import json
import subprocess
import tempfile
import os
import re
import time
import requests
from datetime import datetime, timedelta
import sys

# API Keys
TWITCH_CLIENT_ID = "2pvkgujcf9ofe7pofsvl192jplkx2l"
TWITCH_CLIENT_SECRET = "p2x9rkn34lg6vas3atdb3tti42j58b"
ASSEMBLYAI_API_KEY = "d075180583e743dc84435b50f422373b"
OPENAI_API_KEY = "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"

def lambda_handler(event, context):
    """Main Lambda handler"""
    try:
        # Parse request
        if 'body' in event:
            body = json.loads(event['body']) if isinstance(event['body'], str) else event['body']
        else:
            body = event
        
        stream_url = body.get('stream_url')
        duration_minutes = body.get('duration_minutes', 30)
        user_id = body.get('user_id', 'lambda-user')
        
        print(f"🎯 LAMBDA_CATCHUP: {stream_url} ({duration_minutes}min)")
        
        # Process the catch-up request
        result = process_catchup_request(stream_url, duration_minutes)
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type'
            },
            'body': json.dumps(result)
        }
        
    except Exception as e:
        print(f"❌ Lambda error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({
                'status': 'error',
                'error': f'Lambda processing failed: {str(e)}'
            })
        }

def process_catchup_request(stream_url, duration_minutes):
    """Process catch-up request using original working logic"""
    try:
        print(f"🔵 TWITCH STRATEGY: {stream_url} ({duration_minutes}min)")
        
        # Get Twitch access token
        access_token = get_twitch_access_token()
        if not access_token:
            return {"status": "error", "error": "Failed to get Twitch API access token"}
        
        # Extract streamer username from URL  
        username = extract_streamer_name_from_url(stream_url)
        if not username:
            return {"status": "error", "error": "Could not extract streamer username from URL"}
        
        print(f"👤 Streamer: {username}")
        
        # Get user ID
        user_id = get_user_id_from_username(username, access_token)
        if not user_id:
            return {"status": "error", "error": f"Could not find Twitch user ID for '{username}'"}
        
        print(f"🆔 User ID: {user_id}")
        
        # Get current live stream + stream_id
        live_stream = get_current_live_stream(user_id, access_token)
        if not live_stream:
            return {"status": "error", "error": f"'{username}' is not currently live. Catch-up requires an active stream."}
        
        stream_id = live_stream['stream_id']
        print(f"🔴 Live stream ID: {stream_id}")
        
        # Find in-progress VOD
        vod = find_in_progress_vod(user_id, stream_id, access_token)
        if not vod:
            return {"status": "error", "error": "No in-progress VOD found for this live stream"}
        
        vod_id = vod['id']
        vod_duration = vod.get('duration', '')
        print(f"📺 Found VOD: {vod_id} (duration: {vod_duration})")
        
        # Compute slice parameters
        slice_params, error = compute_slice_parameters(vod_duration, duration_minutes)
        if error:
            return {"status": "error", "error": f"Cannot compute slice parameters: {error}"}
        
        # Create temp directory
        temp_dir = tempfile.mkdtemp()
        print(f"📁 Working in: {temp_dir}")
        
        # Download VOD segment as MP3 (this is where AWS Lambda should work!)
        print(f"📥 Downloading VOD segment from AWS Lambda...")
        audio_file = download_vod_segment_as_mp3(vod_id, slice_params, temp_dir)
        
        if not audio_file:
            # Create fallback with deep links
            start_time = slice_params.get('start_time', '0:00:00') if slice_params else '0:00:00'
            deep_link = f"https://www.twitch.tv/videos/{vod_id}?t={start_time.replace(':', 'h', 1).replace(':', 'm', 1)}s"
            
            return {
                "status": "complete",
                "summary": f"🎮 **Stream Catch-Up** ({duration_minutes} minutes)\n\n⚠️ **Audio extraction failed from AWS Lambda**\nThis might still be IP-based blocking, but we successfully detected the live VOD!\n\n**🔗 Direct Link:**\n{deep_link}\n\n**📊 VOD Details:**\n• VOD ID: {vod_id}\n• Duration: {vod_duration}\n• Stream: {live_stream.get('title', 'Untitled')}\n\n*Click the link above to manually watch the last {duration_minutes} minutes.*",
                "fullTranscript": "Audio extraction failed - no transcript available",
                "duration": duration_minutes,
                "streamUrl": stream_url,
                "method": "aws_lambda_fallback",
                "vodUrl": f"https://www.twitch.tv/videos/{vod_id}",
                "deepLink": deep_link
            }
        
        print(f"📝 Transcribing audio with AssemblyAI...")
        transcript = transcribe_audio_file(audio_file)
        
        if not transcript:
            return {"status": "error", "error": "Failed to transcribe audio"}
        
        print(f"🤖 Generating AI summary...")
        summary = generate_ai_summary(transcript, duration_minutes, stream_url)
        
        # Cleanup
        try:
            os.remove(audio_file)
            os.rmdir(temp_dir)
        except:
            pass
        
        return {
            "status": "complete", 
            "summary": summary,
            "fullTranscript": transcript,
            "duration": duration_minutes,
            "streamUrl": stream_url,
            "method": "aws_lambda_success",
            "processingTime": "AWS Lambda processing"
        }
        
    except Exception as e:
        print(f"❌ Processing error: {str(e)}")
        return {"status": "error", "error": f"Processing failed: {str(e)}"}

def download_vod_segment_as_mp3(vod_id, slice_params, temp_dir):
    """Download VOD segment as MP3 using yt-dlp (AWS Lambda IPs)"""
    try:
        vod_url = f"https://www.twitch.tv/videos/{vod_id}"
        print(f"📥 Downloading from AWS Lambda: {vod_url}")
        
        output_file = os.path.join(temp_dir, f"vod_{vod_id}_segment")
        
        # Build yt-dlp command with MP3 extraction
        cmd = [
            "/opt/python/bin/yt-dlp",  # Lambda layer path
            "-f", "bestaudio",
            "--extract-audio",
            "--audio-format", "mp3",
            "-o", output_file + ".%(ext)s",
            "--no-warnings"
        ]
        
        # Add section slicing if specified
        if slice_params and slice_params.get('slice_option'):
            duration_seconds = slice_params.get('actual_duration', 1800)
            slice_option = f"*-{duration_seconds}-inf"
            cmd.extend(["--download-sections", slice_option])
            print(f"⏰ Slicing: last {duration_seconds}s using {slice_option}")
        
        print(f"🔧 Lambda command: {' '.join(cmd)}")
        
        # Execute with AWS Lambda's longer timeout
        result = subprocess.run(cmd, timeout=600, capture_output=True, text=True, cwd=temp_dir)  # 10 min timeout
        
        print(f"📊 yt-dlp return code: {result.returncode}")
        if result.stderr:
            print(f"📊 yt-dlp stderr: {result.stderr[:300]}")
        if result.stdout:
            print(f"📊 yt-dlp stdout: {result.stdout[:300]}")
        
        if result.returncode == 0:
            # Find MP3 file
            for file in os.listdir(temp_dir):
                if file.startswith(f"vod_{vod_id}_segment") and file.endswith('.mp3'):
                    file_path = os.path.join(temp_dir, file)
                    file_size = os.path.getsize(file_path)
                    print(f"✅ Downloaded MP3: {file_path} ({file_size/1024/1024:.1f}MB)")
                    return file_path
        
        print(f"❌ yt-dlp failed from AWS Lambda: {result.stderr}")
        return None
        
    except subprocess.TimeoutExpired:
        print(f"❌ Lambda download timeout")
        return None
    except Exception as e:
        print(f"❌ Lambda download error: {str(e)}")
        return None

# Copy all the helper functions from our working Vercel version
def get_twitch_access_token():
    """Get Twitch API access token"""
    try:
        response = requests.post('https://id.twitch.tv/oauth2/token', data={
            'client_id': TWITCH_CLIENT_ID,
            'client_secret': TWITCH_CLIENT_SECRET,
            'grant_type': 'client_credentials'
        }, timeout=10)
        
        if response.status_code == 200:
            return response.json().get('access_token')
        return None
    except Exception as e:
        print(f"❌ Twitch token error: {str(e)}")
        return None

def extract_streamer_name_from_url(twitch_url: str):
    """Extract streamer username from Twitch URL"""
    match = re.search(r'twitch\.tv/([^/?]+)', twitch_url)
    return match.group(1) if match else None

def get_user_id_from_username(username: str, access_token: str):
    """Get Twitch user ID from username"""
    try:
        headers = {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': f'Bearer {access_token}'
        }
        
        response = requests.get(f'https://api.twitch.tv/helix/users?login={username}', 
                              headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('data'):
                return data['data'][0]['id']
        return None
    except Exception as e:
        print(f"❌ User ID error: {str(e)}")
        return None

def get_current_live_stream(user_id: str, access_token: str):
    """Get current live stream info"""
    try:
        headers = {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': f'Bearer {access_token}'
        }
        
        response = requests.get(f'https://api.twitch.tv/helix/streams?user_id={user_id}', 
                              headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            if data.get('data') and len(data['data']) > 0:
                stream = data['data'][0]
                return {
                    'stream_id': stream['id'],
                    'title': stream.get('title', 'Untitled Stream'),
                    'started_at': stream.get('started_at')
                }
        return None
    except Exception as e:
        print(f"❌ Live stream error: {str(e)}")
        return None

def find_in_progress_vod(user_id: str, stream_id: str, access_token: str):
    """Find in-progress VOD for current live stream"""
    try:
        headers = {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': f'Bearer {access_token}'
        }
        
        response = requests.get(f'https://api.twitch.tv/helix/videos?user_id={user_id}&type=archive&first=5', 
                              headers=headers, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            vods = data.get('data', [])
            
            for vod in vods:
                if vod.get('stream_id') == stream_id:
                    return vod
        return None
    except Exception as e:
        print(f"❌ VOD search error: {str(e)}")
        return None

def parse_twitch_duration(duration_str: str) -> int:
    """Parse Twitch duration string to total seconds"""
    if not duration_str:
        return 0
    
    total_seconds = 0
    hours_match = re.search(r'(\d+)h', duration_str)
    if hours_match:
        total_seconds += int(hours_match.group(1)) * 3600
    
    minutes_match = re.search(r'(\d+)m', duration_str)
    if minutes_match:
        total_seconds += int(minutes_match.group(1)) * 60
    
    seconds_match = re.search(r'(\d+)s', duration_str)
    if seconds_match:
        total_seconds += int(seconds_match.group(1))
    
    return total_seconds

def compute_slice_parameters(duration_str: str, window_minutes: int):
    """Compute slice parameters for yt-dlp"""
    available_seconds = parse_twitch_duration(duration_str)
    want_seconds = window_minutes * 60
    
    if available_seconds == 0:
        return None, "Cannot determine VOD duration"
    
    if available_seconds <= want_seconds:
        return {
            'slice_option': None,
            'actual_duration': available_seconds,
            'from_end': False
        }, None
    else:
        slice_start_seconds = available_seconds - want_seconds
        slice_start_formatted = f"{slice_start_seconds // 3600:02d}:{(slice_start_seconds % 3600) // 60:02d}:{slice_start_seconds % 60:02d}"
        
        return {
            'slice_option': True,
            'actual_duration': want_seconds,
            'from_end': True,
            'start_time': slice_start_formatted,
            'start_seconds': slice_start_seconds
        }, None

def transcribe_audio_file(audio_file):
    """Transcribe MP3 with AssemblyAI"""
    try:
        with open(audio_file, 'rb') as f:
            upload_response = requests.post(
                'https://api.assemblyai.com/v2/upload',
                files={'file': f},
                headers={'authorization': ASSEMBLYAI_API_KEY},
                timeout=30
            )
        
        if upload_response.status_code != 200:
            return None
        
        audio_url = upload_response.json()['upload_url']
        
        transcript_response = requests.post(
            'https://api.assemblyai.com/v2/transcript',
            json={'audio_url': audio_url},
            headers={'authorization': ASSEMBLYAI_API_KEY}
        )
        
        if transcript_response.status_code != 200:
            return None
        
        transcript_id = transcript_response.json()['id']
        
        # Poll for completion
        for i in range(60):  # 5 minutes max
            status_response = requests.get(
                f'https://api.assemblyai.com/v2/transcript/{transcript_id}',
                headers={'authorization': ASSEMBLYAI_API_KEY}
            )
            
            if status_response.status_code == 200:
                status_data = status_response.json()
                if status_data['status'] == 'completed':
                    return status_data['text']
                elif status_data['status'] == 'error':
                    return None
            
            time.sleep(5)
        
        return None
        
    except Exception as e:
        print(f"❌ Transcription error: {str(e)}")
        return None

def generate_ai_summary(transcript, duration_minutes, stream_url):
    """Generate AI summary with OpenAI"""
    try:
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
                        'content': 'Create a concise, engaging summary of this stream transcript. Focus on key moments, interesting content, and notable events.'
                    },
                    {
                        'role': 'user',
                        'content': f'Summarize the last {duration_minutes} minutes of this livestream:\\n\\n{transcript}'
                    }
                ],
                'max_tokens': 500,
                'temperature': 0.7
            }
        )
        
        if response.status_code == 200:
            summary = response.json()['choices'][0]['message']['content']
            
            formatted_summary = f"""🎮 **AWS Lambda Catch-Up Success!** ({duration_minutes} minutes)

{summary}

**📊 Processing Details:**
• Source: {stream_url}
• Method: AWS Lambda VOD download + AI analysis
• Transcript length: {len(transcript)} characters
• Processing: Complete ⚡

**🎯 Powered by AWS Lambda**
*Successful serverless VOD processing with different IP infrastructure*"""
            
            return formatted_summary
        else:
            return f"AI Summary generation failed: {response.status_code}"
            
    except Exception as e:
        return f"Summary error: {str(e)}"