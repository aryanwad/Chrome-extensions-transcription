"""
Secure transcription proxy service
Handles API calls to AssemblyAI and OpenAI while keeping API keys secure
"""

import json
import os
import uuid
import requests
import tempfile
import subprocess
import time
import base64
import boto3
from datetime import datetime, timedelta
from typing import Dict, Any

from .auth import authenticate_request, lambda_response, convert_decimals
from .credits import check_credits, deduct_credits, CREDIT_COSTS

# API Keys (secure environment variables)
ASSEMBLYAI_API_KEY = os.environ['ASSEMBLYAI_API_KEY']
OPENAI_API_KEY = os.environ['OPENAI_API_KEY']
TWITCH_CLIENT_ID = os.environ['TWITCH_CLIENT_ID']
TWITCH_CLIENT_SECRET = os.environ['TWITCH_CLIENT_SECRET']
S3_BUCKET_AUDIO = os.environ['S3_BUCKET_AUDIO']

# Initialize S3 client
s3_client = boto3.client('s3')

def stream_proxy(event, context):
    """
    Provide secure API access for real-time transcription
    Returns API key and starts credit tracking session
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
        
        # Convert Decimal objects
        user_data = convert_decimals(user_data)
        
        # Parse request
        body = json.loads(event['body'])
        action = body.get('action', 'start')
        
        if action == 'start':
            # Check if user has sufficient credits (minimum 10 for 1 minute) - skip for admin users
            if not user_data.get('is_admin', False) and user_data.get('credits_balance', 0) < 10:
                return lambda_response(402, {'error': 'Insufficient credits. Minimum 10 credits required to start transcription.'})
            
            # Return API key for direct connection
            return lambda_response(200, {
                'success': True,
                'assemblyai_api_key': ASSEMBLYAI_API_KEY,
                'session_id': str(uuid.uuid4()),
                'credits_balance': user_data.get('credits_balance', 0)
            })
            
        elif action == 'stop':
            # TODO: Calculate actual usage and deduct credits
            # For now, deduct 10 credits per session
            return lambda_response(200, {'success': True, 'message': 'Session ended'})
            
        else:
            return lambda_response(400, {'error': 'Invalid action'})
        
    except json.JSONDecodeError:
        return lambda_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Stream proxy error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})

def start_stream_session(user_data: Dict, request_data: Dict):
    """
    Start a new streaming transcription session
    """
    # Check if user has enough credits for at least 1 minute
    credits_per_minute = CREDIT_COSTS['live_transcription_per_minute']
    has_credits, balance = check_credits(user_data['user_id'], credits_per_minute)
    
    if not has_credits:
        return lambda_response(402, {
            'error': 'Insufficient credits',
            'required': credits_per_minute,
            'balance': balance
        })
    
    # Create WebSocket URL for AssemblyAI
    websocket_url = f"wss://streaming.assemblyai.com/v3/ws?sample_rate=16000&format_turns=true&token={ASSEMBLYAI_API_KEY}"
    
    return lambda_response(200, {
        'websocket_url': websocket_url,
        'session_id': str(uuid.uuid4()),
        'credits_per_minute': credits_per_minute,
        'current_balance': balance
    })

def proxy_audio_data(user_data: Dict, request_data: Dict):
    """
    Handle audio data forwarding and credit deduction
    Note: In a real implementation, you'd want WebSocket handling
    This is simplified for HTTP-based proxy
    """
    # For now, return success - actual WebSocket proxy would be more complex
    return lambda_response(200, {'status': 'audio_received'})

def stop_stream_session(user_data: Dict, request_data: Dict):
    """
    Stop streaming session and deduct final credits
    """
    duration_minutes = request_data.get('duration_minutes', 1)
    credits_to_deduct = duration_minutes * CREDIT_COSTS['live_transcription_per_minute']
    
    # Deduct credits for actual usage
    success = deduct_credits(
        user_data['user_id'],
        credits_to_deduct,
        'live_transcription',
        {'duration_minutes': duration_minutes}
    )
    
    if not success:
        return lambda_response(402, {'error': 'Unable to deduct credits'})
    
    return lambda_response(200, {
        'status': 'session_stopped',
        'credits_deducted': credits_to_deduct
    })

def catchup_proxy(event, context):
    """
    Proxy catch-up transcription requests
    Handles the full pipeline: VOD detection -> Download -> Transcribe -> Summarize
    """
    try:
        print(f"🎯 CATCHUP: Starting catch-up request processing")
        print(f"🎯 CATCHUP: Event body: {event.get('body', 'No body')}")
        
        # Authenticate user
        print(f"🎯 CATCHUP: Authenticating user...")
        user_data, error_response = authenticate_request(event)
        if error_response:
            print(f"❌ CATCHUP: Authentication failed: {error_response}")
            return error_response
        print(f"✅ CATCHUP: User authenticated: {user_data.get('user_id', 'unknown')}")
        
        # Parse request
        print(f"🎯 CATCHUP: Parsing request body...")
        body = json.loads(event['body'])
        stream_url = body.get('stream_url')
        duration_minutes = body.get('duration_minutes', 30)
        print(f"✅ CATCHUP: Parsed - URL: {stream_url}, Duration: {duration_minutes}min")
        
        if not stream_url:
            print(f"❌ CATCHUP: Missing stream_url")
            return lambda_response(400, {'error': 'stream_url is required'})
        
        # Validate duration and calculate credits
        if duration_minutes not in [30, 60]:
            print(f"❌ CATCHUP: Invalid duration: {duration_minutes}")
            return lambda_response(400, {'error': 'duration_minutes must be 30 or 60'})
        
        print(f"🎯 CATCHUP: Calculating credits needed...")
        try:
            credits_needed = CREDIT_COSTS[f'catchup_{duration_minutes}min']
            print(f"✅ CATCHUP: Credits needed: {credits_needed}")
        except KeyError as e:
            print(f"❌ CATCHUP: Credit cost lookup failed: {e}")
            return lambda_response(500, {'error': f'Credit configuration error: {e}'})
        
        # Check credits
        print(f"🎯 CATCHUP: Checking user credits...")
        try:
            has_credits, balance = check_credits(user_data['user_id'], credits_needed)
            print(f"✅ CATCHUP: Credit check - Has credits: {has_credits}, Balance: {balance}")
        except Exception as e:
            print(f"❌ CATCHUP: Credit check failed: {e}")
            return lambda_response(500, {'error': f'Credit check error: {e}'})
            
        if not has_credits:
            print(f"❌ CATCHUP: Insufficient credits - needed: {credits_needed}, has: {balance}")
            return lambda_response(402, {
                'error': 'Insufficient credits',
                'required': credits_needed,
                'balance': balance
            })
        
        # Process catch-up request
        print(f"🎯 CATCHUP: Starting catch-up processing...")
        try:
            result = process_catchup_request(stream_url, duration_minutes)
            print(f"✅ CATCHUP: Processing completed - Success: {result.get('success', False)}")
        except Exception as e:
            print(f"❌ CATCHUP: Processing failed with exception: {e}")
            import traceback
            print(f"❌ CATCHUP: Traceback: {traceback.format_exc()}")
            return lambda_response(500, {'error': f'Processing failed: {str(e)}'})
        
        if result['success']:
            print(f"🎯 CATCHUP: Deducting credits...")
            try:
                deduct_result = deduct_credits(
                    user_data['user_id'],
                    credits_needed,
                    f'catchup_{duration_minutes}min',
                    {
                        'stream_url': stream_url,
                        'duration_minutes': duration_minutes,
                        'transcript_length': len(result.get('transcript', ''))
                    }
                )
                print(f"✅ CATCHUP: Credits deducted successfully: {deduct_result}")
            except Exception as e:
                print(f"⚠️ CATCHUP: Credit deduction failed: {e}")
                # Don't fail the request if deduction fails
            
            print(f"✅ CATCHUP: Returning successful response")
            return lambda_response(200, {
                'success': True,
                'data': result['data'],
                'credits_used': credits_needed,
                'remaining_balance': balance - credits_needed
            })
        else:
            print(f"❌ CATCHUP: Processing failed - Error: {result.get('error', 'Unknown')}")
            return lambda_response(400, {
                'error': result['error'],
                'details': result.get('details', '')
            })
        
    except json.JSONDecodeError as e:
        print(f"❌ CATCHUP: JSON decode error: {e}")
        return lambda_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"❌ CATCHUP: Unexpected error: {e}")
        import traceback
        print(f"❌ CATCHUP: Traceback: {traceback.format_exc()}")
        return lambda_response(500, {'error': f'Internal server error: {str(e)}'})

def process_catchup_request(stream_url: str, duration_minutes: int) -> Dict:
    """
    Process catch-up request: detect platform, get VOD, transcribe, summarize
    """
    try:
        print(f"🔄 PROCESS: Starting catchup processing for {stream_url}")
        
        # Step 1: Detect platform and get VOD URL
        print(f"🔄 PROCESS: Step 1 - Detecting platform...")
        try:
            platform = detect_platform(stream_url)
            print(f"✅ PROCESS: Platform detected: {platform}")
        except Exception as e:
            print(f"❌ PROCESS: Platform detection failed: {e}")
            return {
                'success': False,
                'error': f'Platform detection failed: {str(e)}'
            }
        
        print(f"🔄 PROCESS: Step 2 - Getting VOD URL...")
        try:
            if platform == 'twitch':
                print(f"🔄 PROCESS: Using Twitch API for VOD...")
                vod_url = get_twitch_vod_url(stream_url, duration_minutes)
            else:
                print(f"🔄 PROCESS: Using direct URL for {platform}...")
                vod_url = stream_url
            print(f"✅ PROCESS: VOD URL obtained: {vod_url[:100] if vod_url else 'None'}...")
        except Exception as e:
            print(f"❌ PROCESS: VOD URL retrieval failed: {e}")
            return {
                'success': False,
                'error': f'VOD URL retrieval failed: {str(e)}'
            }
        
        if not vod_url:
            print(f"❌ PROCESS: No VOD URL found")
            return {
                'success': False,
                'error': 'Could not find VOD for the specified time period'
            }
        
        # Step 2: Download audio using yt-dlp
        print(f"🔄 PROCESS: Step 3 - Downloading audio...")
        try:
            audio_file_path = download_vod_audio(vod_url, duration_minutes)
            print(f"✅ PROCESS: Audio download result: {audio_file_path}")
        except Exception as e:
            print(f"❌ PROCESS: Audio download failed: {e}")
            return {
                'success': False,
                'error': f'Audio download failed: {str(e)}'
            }
            
        if not audio_file_path:
            print(f"❌ PROCESS: No audio file path returned")
            return {
                'success': False,
                'error': 'Failed to download audio from VOD'
            }
        
        # Step 3: Transcribe with AssemblyAI
        print(f"🔄 PROCESS: Step 4 - Transcribing audio...")
        try:
            transcript = transcribe_audio_file(audio_file_path)
            print(f"✅ PROCESS: Transcription result length: {len(transcript) if transcript else 0}")
        except Exception as e:
            print(f"❌ PROCESS: Transcription failed: {e}")
            return {
                'success': False,
                'error': f'Transcription failed: {str(e)}'
            }
            
        if not transcript:
            print(f"❌ PROCESS: No transcript returned")
            return {
                'success': False,
                'error': 'Failed to transcribe audio'
            }
        
        # Step 4: Generate AI summary with OpenAI
        print(f"🔄 PROCESS: Step 5 - Generating AI summary...")
        try:
            summary = generate_ai_summary(transcript, duration_minutes, stream_url)
            print(f"✅ PROCESS: Summary generated, length: {len(summary)}")
        except Exception as e:
            print(f"❌ PROCESS: Summary generation failed: {e}")
            summary = f"Summary generation failed: {str(e)}"
        
        # Step 5: Clean up temporary file
        print(f"🔄 PROCESS: Step 6 - Cleaning up temporary files...")
        try:
            if audio_file_path and os.path.exists(audio_file_path):
                os.remove(audio_file_path)
                print(f"✅ PROCESS: Temporary file cleaned up: {audio_file_path}")
        except Exception as e:
            print(f"⚠️ PROCESS: Cleanup failed: {e}")
        
        print(f"✅ PROCESS: Catchup processing completed successfully")
        return {
            'success': True,
            'data': {
                'summary': summary,
                'fullTranscript': transcript[:5000],  # Truncate for response size
                'duration': duration_minutes,
                'streamUrl': stream_url,
                'method': 'aws_lambda_proxy',
                'processingTime': 'Secure backend processing'
            }
        }
        
    except Exception as e:
        print(f"❌ PROCESS: Unexpected processing error: {e}")
        import traceback
        print(f"❌ PROCESS: Traceback: {traceback.format_exc()}")
        return {
            'success': False,
            'error': 'Processing failed',
            'details': str(e)
        }

def detect_platform(stream_url: str) -> str:
    """Detect streaming platform from URL"""
    if 'twitch.tv' in stream_url:
        return 'twitch'
    elif 'youtube.com' in stream_url or 'youtu.be' in stream_url:
        return 'youtube'
    elif 'kick.com' in stream_url:
        return 'kick'
    else:
        return 'unknown'

def get_twitch_vod_url(stream_url: str, duration_minutes: int) -> str:
    """
    Get Twitch VOD URL using Twitch API
    Returns the most recent clips or VOD for the time period
    """
    try:
        # Extract channel name from URL
        channel_name = stream_url.split('/')[-1]
        
        # Get OAuth token for Twitch API
        auth_response = requests.post('https://id.twitch.tv/oauth2/token', {
            'client_id': TWITCH_CLIENT_ID,
            'client_secret': TWITCH_CLIENT_SECRET,
            'grant_type': 'client_credentials'
        })
        
        if auth_response.status_code != 200:
            return None
        
        access_token = auth_response.json()['access_token']
        headers = {
            'Client-ID': TWITCH_CLIENT_ID,
            'Authorization': f'Bearer {access_token}'
        }
        
        # Get user ID
        user_response = requests.get(
            f'https://api.twitch.tv/helix/users?login={channel_name}',
            headers=headers
        )
        
        if user_response.status_code != 200:
            return None
        
        users = user_response.json().get('data', [])
        if not users:
            return None
        
        user_id = users[0]['id']
        
        # Get recent clips
        started_at = datetime.utcnow().isoformat().replace('+00:00', 'Z')
        clips_response = requests.get(
            f'https://api.twitch.tv/helix/clips',
            headers=headers,
            params={
                'broadcaster_id': user_id,
                'started_at': started_at,
                'first': 20
            }
        )
        
        if clips_response.status_code == 200:
            clips = clips_response.json().get('data', [])
            if clips:
                # Return URL of the most recent clip
                return clips[0]['url']
        
        return None
        
    except Exception as e:
        print(f"Twitch API error: {e}")
        return None

def download_vod_audio(vod_url: str, duration_minutes: int) -> str:
    """
    Download audio from VOD using yt-dlp
    Returns path to downloaded audio file
    """
    try:
        # Create temporary file
        temp_dir = tempfile.mkdtemp()
        output_file = os.path.join(temp_dir, 'catchup_audio')
        
        # Calculate section parameters for last N minutes
        duration_seconds = duration_minutes * 60
        slice_option = f"*-{duration_seconds}-inf"
        
        # Build yt-dlp command
        cmd = [
            'yt-dlp',
            '-f', 'bestaudio',
            '--extract-audio', '--audio-format', 'mp3',
            '--download-sections', slice_option,
            '-o', output_file + '.%(ext)s',
            '--no-warnings',
            vod_url
        ]
        
        # Execute download
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        
        if result.returncode == 0:
            # Find the downloaded MP3 file
            files_in_temp = os.listdir(temp_dir)
            for file in files_in_temp:
                if file.startswith('catchup_audio') and file.endswith('.mp3'):
                    return os.path.join(temp_dir, file)
        
        return None
        
    except Exception as e:
        print(f"Download error: {e}")
        return None

def transcribe_audio_file(audio_file_path: str) -> str:
    """
    Transcribe audio file using AssemblyAI
    """
    try:
        print(f"🔄 TRANSCRIBE: Starting transcription for file: {audio_file_path}")
        print(f"📊 TRANSCRIBE: File exists: {os.path.exists(audio_file_path)}")
        if os.path.exists(audio_file_path):
            print(f"📊 TRANSCRIBE: File size: {os.path.getsize(audio_file_path)} bytes")
        
        # Upload file to AssemblyAI
        print(f"📤 TRANSCRIBE: Uploading to AssemblyAI...")
        with open(audio_file_path, 'rb') as f:
            upload_response = requests.post(
                'https://api.assemblyai.com/v2/upload',
                files={'file': f},
                headers={'authorization': ASSEMBLYAI_API_KEY},
                timeout=60
            )
        
        print(f"📨 TRANSCRIBE: Upload response status: {upload_response.status_code}")
        if upload_response.status_code != 200:
            print(f"❌ TRANSCRIBE: Upload failed: {upload_response.text}")
            return None
        
        upload_data = upload_response.json()
        audio_url = upload_data['upload_url']
        print(f"✅ TRANSCRIBE: File uploaded successfully: {audio_url[:50]}...")
        
        # Start transcription
        print(f"🔄 TRANSCRIBE: Starting transcription job...")
        transcript_response = requests.post(
            'https://api.assemblyai.com/v2/transcript',
            json={'audio_url': audio_url},
            headers={'authorization': ASSEMBLYAI_API_KEY}
        )
        
        print(f"📨 TRANSCRIBE: Transcript job response status: {transcript_response.status_code}")
        if transcript_response.status_code != 200:
            print(f"❌ TRANSCRIBE: Transcript job failed: {transcript_response.text}")
            return None
        
        transcript_data = transcript_response.json()
        transcript_id = transcript_data['id']
        print(f"✅ TRANSCRIBE: Transcript job started: {transcript_id}")
        
        # Poll for completion
        print(f"⏳ TRANSCRIBE: Polling for completion...")
        for i in range(120):  # 10 minutes max
            status_response = requests.get(
                f'https://api.assemblyai.com/v2/transcript/{transcript_id}',
                headers={'authorization': ASSEMBLYAI_API_KEY}
            )
            
            if status_response.status_code == 200:
                status_data = status_response.json()
                print(f"📊 TRANSCRIBE: Poll {i+1}/120 - Status: {status_data.get('status', 'unknown')}")
                
                if status_data['status'] == 'completed':
                    transcript_text = status_data.get('text', '')
                    print(f"✅ TRANSCRIBE: Transcription completed! Length: {len(transcript_text)} chars")
                    return transcript_text
                elif status_data['status'] == 'error':
                    error_msg = status_data.get('error', 'Unknown transcription error')
                    print(f"❌ TRANSCRIBE: Transcription failed with error: {error_msg}")
                    return None
            else:
                print(f"❌ TRANSCRIBE: Status check failed: {status_response.status_code}")
            
            time.sleep(5)
        
        print(f"⏰ TRANSCRIBE: Transcription timed out after 10 minutes")
        return None
        
    except Exception as e:
        print(f"❌ TRANSCRIBE: Exception during transcription: {e}")
        import traceback
        print(f"❌ TRANSCRIBE: Traceback: {traceback.format_exc()}")
        return None

def generate_ai_summary(transcript: str, duration_minutes: int, stream_url: str) -> str:
    """
    Generate AI summary using OpenAI GPT-4
    """
    try:
        response = requests.post(
            'https://api.openai.com/v1/chat/completions',
            headers={
                'Authorization': f'Bearer {OPENAI_API_KEY}',
                'Content-Type': 'application/json'
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
                        'content': f'Summarize the last {duration_minutes} minutes of this livestream from {stream_url}:\n\n{transcript}'
                    }
                ],
                'max_tokens': 500,
                'temperature': 0.7
            },
            timeout=30
        )
        
        if response.status_code != 200:
            print(f"OpenAI API error: {response.status_code} - {response.text}")
            return f"Summary generation failed: API error {response.status_code}"
        
        ai_response = response.json()
        summary = ai_response['choices'][0]['message']['content']
        
        formatted_summary = f"""🎮 **Secure Backend Catch-Up Success!** ({duration_minutes} minutes)

{summary}

**📊 Processing Details:**
• Source: {stream_url}
• Method: Secure AWS Lambda processing
• Transcript length: {len(transcript)} characters
• Processing: Complete ⚡

**🔒 Powered by Secure Backend**
*Your API keys are safe and hidden from users*"""
        
        return formatted_summary
        
    except requests.RequestException as e:
        print(f"OpenAI request error: {e}")
        return f"Summary generation failed: API request error"
    except Exception as e:
        print(f"AI summary error: {e}")
        return f"Summary generation failed: {str(e)}"

def ask_proxy(event, context):
    """
    AI Question answering proxy for transcript analysis
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
        
        # Parse request
        body = json.loads(event['body'])
        question = body.get('question', '').strip()
        transcript = body.get('transcript', '').strip()
        
        if not question:
            return lambda_response(400, {'error': 'Question is required'})
        
        if not transcript:
            return lambda_response(400, {'error': 'No transcript available. Please start transcription first and wait for some content to be transcribed.'})
        
        # Check credits (5 credits per question)
        user_data = convert_decimals(user_data)
        current_balance = user_data.get('credits_balance', 0)
        credits_needed = 5
        
        if current_balance < credits_needed:
            return lambda_response(402, {
                'error': 'Insufficient credits',
                'required': credits_needed,
                'balance': current_balance
            })
        
        try:
            # Generate AI response using OpenAI
            response = requests.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {OPENAI_API_KEY}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'gpt-4',
                    'messages': [
                        {
                            'role': 'system',
                            'content': 'You are a helpful assistant analyzing a live stream transcript. Answer questions about the content accurately and concisely based only on the provided transcript.'
                        },
                        {
                            'role': 'user', 
                            'content': f'Based on this transcript: "{transcript}"\n\nQuestion: {question}'
                        }
                    ],
                    'max_tokens': 300,
                    'temperature': 0.7
                },
                timeout=30
            )
            
            if response.status_code != 200:
                print(f"OpenAI API error: {response.status_code} - {response.text}")
                return lambda_response(500, {'error': 'AI service temporarily unavailable'})
            
            ai_response = response.json()
            answer = ai_response['choices'][0]['message']['content']
            
            # TODO: Deduct credits here (implement credit deduction)
            # For now, just return the answer
            
            return lambda_response(200, {
                'success': True,
                'answer': answer,
                'credits_used': credits_needed,
                'remaining_balance': current_balance - credits_needed
            })
            
        except requests.RequestException as e:
            print(f"OpenAI request error: {e}")
            return lambda_response(500, {'error': 'Failed to process AI request'})
        
    except json.JSONDecodeError:
        return lambda_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Ask proxy error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})

def twitch_credentials(event, context):
    """
    Securely provide Twitch API credentials to authenticated users
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
            
        # Return Twitch credentials from environment
        return lambda_response(200, {
            'client_id': TWITCH_CLIENT_ID,
            'client_secret': TWITCH_CLIENT_SECRET
        })
        
    except Exception as e:
        print(f"❌ TWITCH_CREDS: Error: {e}")
        return lambda_response(500, {'error': f'Internal server error: {str(e)}'})

def init_chunked_upload(event, context):
    """
    Initialize chunked audio upload session
    """
    try:
        # Authenticate user  
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
            
        body = json.loads(event['body'])
        total_size = body.get('total_size')
        total_chunks = body.get('total_chunks')
        format_type = body.get('format', 'pcm16')
        sample_rate = body.get('sample_rate', 16000)
        metadata = body.get('metadata', {})
        
        # Generate unique upload ID
        upload_id = f"{user_data['user_id']}_{int(time.time())}_{total_chunks}chunks"
        
        # Store upload session info (in production, use DynamoDB)
        upload_session = {
            'upload_id': upload_id,
            'user_id': user_data['user_id'],
            'total_size': total_size,
            'total_chunks': total_chunks,
            'format': format_type,
            'sample_rate': sample_rate,
            'metadata': metadata,
            'created_at': int(time.time()),
            'chunks_received': 0,
            'chunks_data': {}  # Store chunks temporarily
        }
        
        # In production, save to DynamoDB
        # For now, store in Lambda /tmp (not persistent across invocations)
        session_file = f"/tmp/upload_{upload_id}.json"
        with open(session_file, 'w') as f:
            json.dump(upload_session, f)
            
        print(f"✅ CHUNKED_INIT: Upload session created: {upload_id}")
        
        return lambda_response(200, {
            'upload_id': upload_id,
            'total_chunks': total_chunks,
            'chunk_size_limit': 4 * 1024 * 1024  # 4MB
        })
        
    except Exception as e:
        print(f"❌ CHUNKED_INIT: Error: {e}")
        return lambda_response(500, {'error': f'Init failed: {str(e)}'})

def upload_chunk(event, context):
    """
    Upload individual audio chunk
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
            
        body = json.loads(event['body'])
        upload_id = body.get('upload_id')
        chunk_index = body.get('chunk_index')
        chunk_data_b64 = body.get('chunk_data')
        chunk_size = body.get('chunk_size')
        
        if not all([upload_id, chunk_index is not None, chunk_data_b64]):
            return lambda_response(400, {'error': 'Missing required chunk data'})
            
        # Load upload session
        session_file = f"/tmp/upload_{upload_id}.json"
        if not os.path.exists(session_file):
            return lambda_response(404, {'error': 'Upload session not found'})
            
        with open(session_file, 'r') as f:
            upload_session = json.load(f)
            
        # Verify user owns this session
        if upload_session['user_id'] != user_data['user_id']:
            return lambda_response(403, {'error': 'Unauthorized access to upload session'})
            
        # Decode base64 chunk data
        chunk_data = base64.b64decode(chunk_data_b64)
        
        # Store chunk data temporarily
        chunk_file = f"/tmp/chunk_{upload_id}_{chunk_index}.dat"
        with open(chunk_file, 'wb') as f:
            f.write(chunk_data)
            
        # Update session
        upload_session['chunks_received'] += 1
        upload_session['chunks_data'][str(chunk_index)] = {
            'file': chunk_file,
            'size': len(chunk_data),
            'received_at': int(time.time())
        }
        
        # Save updated session
        with open(session_file, 'w') as f:
            json.dump(upload_session, f)
            
        print(f"✅ CHUNKED_UPLOAD: Chunk {chunk_index} received ({len(chunk_data)} bytes)")
        
        return lambda_response(200, {
            'chunk_index': chunk_index,
            'etag': f'chunk_{chunk_index}_{len(chunk_data)}',
            'chunks_received': upload_session['chunks_received'],
            'total_chunks': upload_session['total_chunks']
        })
        
    except Exception as e:
        print(f"❌ CHUNKED_UPLOAD: Error: {e}")
        return lambda_response(500, {'error': f'Chunk upload failed: {str(e)}'})

def finalize_chunked_upload(event, context):
    """
    Finalize chunked upload and process complete audio
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
            
        body = json.loads(event['body'])
        upload_id = body.get('upload_id')
        chunk_results = body.get('chunk_results', [])
        
        if not upload_id:
            return lambda_response(400, {'error': 'Missing upload_id'})
            
        # Load upload session
        session_file = f"/tmp/upload_{upload_id}.json"
        if not os.path.exists(session_file):
            return lambda_response(404, {'error': 'Upload session not found'})
            
        with open(session_file, 'r') as f:
            upload_session = json.load(f)
            
        # Verify user owns this session
        if upload_session['user_id'] != user_data['user_id']:
            return lambda_response(403, {'error': 'Unauthorized access to upload session'})
            
        # Verify all chunks received
        if upload_session['chunks_received'] != upload_session['total_chunks']:
            return lambda_response(400, {
                'error': f"Missing chunks: {upload_session['chunks_received']}/{upload_session['total_chunks']}"
            })
            
        print(f"🔗 CHUNKED_FINALIZE: Reconstructing audio from {upload_session['chunks_received']} chunks")
        
        # Reconstruct complete audio file
        complete_audio_file = f"/tmp/complete_{upload_id}.wav"
        with open(complete_audio_file, 'wb') as outfile:
            for chunk_index in sorted(upload_session['chunks_data'].keys(), key=int):
                chunk_info = upload_session['chunks_data'][chunk_index]
                chunk_file = chunk_info['file']
                
                if os.path.exists(chunk_file):
                    with open(chunk_file, 'rb') as infile:
                        outfile.write(infile.read())
                    # Clean up chunk file
                    os.remove(chunk_file)
                else:
                    print(f"⚠️ CHUNKED_FINALIZE: Missing chunk file {chunk_index}")
                    
        print(f"✅ CHUNKED_FINALIZE: Audio file reconstructed: {complete_audio_file}")
        
        # Process the complete audio file
        result = process_complete_audio(complete_audio_file, upload_session)
        
        # Cleanup
        if os.path.exists(complete_audio_file):
            os.remove(complete_audio_file)
        if os.path.exists(session_file):
            os.remove(session_file)
            
        print(f"✅ CHUNKED_FINALIZE: Processing completed")
        
        return lambda_response(200, {
            'success': True,
            'data': result,
            'upload_id': upload_id,
            'chunks_processed': upload_session['chunks_received']
        })
        
    except Exception as e:
        print(f"❌ CHUNKED_FINALIZE: Error: {e}")
        import traceback
        print(f"❌ CHUNKED_FINALIZE: Traceback: {traceback.format_exc()}")
        return lambda_response(500, {'error': f'Finalization failed: {str(e)}'})

def process_audio(event, context):
    """
    Process single-chunk audio upload
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
            
        body = json.loads(event['body'])
        audio_data_b64 = body.get('audio_data')
        format_type = body.get('format', 'pcm16')
        sample_rate = body.get('sample_rate', 16000)
        is_single_chunk = body.get('is_single_chunk', True)
        metadata = body.get('metadata', {})
        
        if not audio_data_b64:
            return lambda_response(400, {'error': 'Missing audio_data'})
            
        # Decode base64 audio data
        audio_data = base64.b64decode(audio_data_b64)
        
        print(f"🎵 PROCESS_AUDIO: Processing {len(audio_data)} bytes of audio")
        
        # Save audio to temporary file
        audio_file = f"/tmp/audio_{user_data['user_id']}_{int(time.time())}.wav"
        with open(audio_file, 'wb') as f:
            f.write(audio_data)
            
        # Create session-like object for processing
        session = {
            'user_id': user_data['user_id'],
            'format': format_type,
            'sample_rate': sample_rate,
            'metadata': metadata
        }
        
        # Process the audio
        result = process_complete_audio(audio_file, session)
        
        # Cleanup
        if os.path.exists(audio_file):
            os.remove(audio_file)
            
        print(f"✅ PROCESS_AUDIO: Single audio processing completed")
        
        return lambda_response(200, {
            'success': True,
            'data': result
        })
        
    except Exception as e:
        print(f"❌ PROCESS_AUDIO: Error: {e}")
        return lambda_response(500, {'error': f'Audio processing failed: {str(e)}'})

def process_complete_audio(audio_file_path: str, session: dict) -> dict:
    """
    Process complete audio file: transcribe and summarize
    """
    try:
        print(f"🔄 PROCESS_COMPLETE: Processing audio file: {audio_file_path}")
        
        # Get file size
        file_size = os.path.getsize(audio_file_path)
        print(f"📊 PROCESS_COMPLETE: Audio file size: {file_size} bytes")
        
        # Transcribe with AssemblyAI
        print(f"🔄 PROCESS_COMPLETE: Starting transcription...")
        transcript = transcribe_audio_file(audio_file_path)
        
        if not transcript:
            return {
                'error': 'Transcription failed',
                'success': False
            }
            
        print(f"✅ PROCESS_COMPLETE: Transcription completed ({len(transcript)} chars)")
        
        # Generate AI summary
        metadata = session.get('metadata', {})
        stream_url = metadata.get('stream_url', 'Unknown source')
        duration_minutes = metadata.get('duration_minutes', 30)
        
        print(f"🔄 PROCESS_COMPLETE: Generating AI summary...")
        summary = generate_ai_summary(transcript, duration_minutes, stream_url)
        
        print(f"✅ PROCESS_COMPLETE: AI summary generated")
        
        return {
            'success': True,
            'transcript': transcript,
            'summary': summary,
            'metadata': {
                'audio_size_bytes': file_size,
                'transcript_length': len(transcript),
                'processing_method': 'chunked_browser_upload',
                'stream_url': stream_url,
                'duration_minutes': duration_minutes
            }
        }
        
    except Exception as e:
        print(f"❌ PROCESS_COMPLETE: Error: {e}")
        return {
            'error': str(e),
            'success': False
        }

def get_presigned_upload_url(event, context):
    """
    Generate presigned S3 URL for large audio file uploads
    This bypasses API Gateway's 10MB limit for file transfers
    """
    try:
        print(f"🔄 PRESIGNED_URL: Starting presigned URL generation...")
        
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            print(f"❌ PRESIGNED_URL: Authentication failed")
            return error_response
        
        # Convert Decimal objects
        user_data = convert_decimals(user_data)
        
        # Parse request
        body = json.loads(event['body'])
        file_size = body.get('file_size')
        content_type = body.get('content_type', 'audio/pcm')
        metadata = body.get('metadata', {})
        
        if not file_size or file_size <= 0:
            print(f"❌ PRESIGNED_URL: Invalid file_size: {file_size}")
            return lambda_response(400, {'error': 'Valid file_size is required'})
        
        # Validate file size (max 500MB)
        max_file_size = 500 * 1024 * 1024  # 500MB
        if file_size > max_file_size:
            print(f"❌ PRESIGNED_URL: File too large: {file_size} bytes")
            return lambda_response(400, {
                'error': f'File too large. Maximum size is {max_file_size // (1024*1024)}MB, got {file_size // (1024*1024)}MB'
            })
        
        # Check user credits for processing (skip for admin users)
        if not user_data.get('is_admin', False):
            duration_minutes = metadata.get('duration_minutes', 30)
            credits_needed = CREDIT_COSTS.get(f'catchup_{duration_minutes}min', 300)
            has_credits, balance = check_credits(user_data['user_id'], credits_needed)
            
            if not has_credits:
                print(f"❌ PRESIGNED_URL: Insufficient credits - needed: {credits_needed}, has: {balance}")
                return lambda_response(402, {
                    'error': 'Insufficient credits',
                    'required': credits_needed,
                    'balance': float(balance) if balance else 0
                })
        
        # Generate unique processing ID and S3 key
        processing_id = str(uuid.uuid4())
        s3_key = f"temp/{user_data['user_id']}/{processing_id}.pcm"
        
        print(f"✅ PRESIGNED_URL: Generated processing ID: {processing_id}")
        print(f"✅ PRESIGNED_URL: S3 key: {s3_key}")
        
        # Generate presigned URL for PUT operation (direct upload)
        try:
            presigned_url = s3_client.generate_presigned_url(
                'put_object',
                Params={
                    'Bucket': S3_BUCKET_AUDIO,
                    'Key': s3_key,
                    'ContentType': content_type,
                    'Metadata': {
                        'user_id': user_data['user_id'],
                        'processing_id': processing_id,
                        'file_size': str(file_size),
                        'upload_timestamp': str(int(time.time())),
                        'stream_url': metadata.get('stream_url', ''),
                        'duration_minutes': str(metadata.get('duration_minutes', 30))
                    }
                },
                ExpiresIn=3600  # URL expires in 1 hour
            )
            print(f"✅ PRESIGNED_URL: Generated presigned URL successfully")
            
        except Exception as e:
            print(f"❌ PRESIGNED_URL: Failed to generate presigned URL: {e}")
            return lambda_response(500, {'error': f'Failed to generate presigned URL: {str(e)}'})
        
        print(f"✅ PRESIGNED_URL: Returning response to client")
        
        return lambda_response(200, {
            'success': True,
            'upload_url': presigned_url,
            's3_key': s3_key,
            'processing_id': processing_id,
            'expires_in': 3600,
            'max_file_size': max_file_size,
            'instructions': 'Upload raw PCM audio data directly to the presigned URL using PUT request'
        })
        
    except json.JSONDecodeError:
        print(f"❌ PRESIGNED_URL: JSON decode error")
        return lambda_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"❌ PRESIGNED_URL: Unexpected error: {e}")
        import traceback
        print(f"❌ PRESIGNED_URL: Traceback: {traceback.format_exc()}")
        return lambda_response(500, {'error': f'Internal server error: {str(e)}'})

def process_s3_audio(event, context):
    """
    Process audio file uploaded to S3 via presigned URL
    Downloads from S3, transcribes with AssemblyAI, and generates AI summary
    """
    try:
        print(f"🔄 S3_PROCESS: Starting S3 audio processing...")
        
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            print(f"❌ S3_PROCESS: Authentication failed")
            return error_response
        
        # Convert Decimal objects
        user_data = convert_decimals(user_data)
        
        # Parse request
        body = json.loads(event['body'])
        processing_id = body.get('processing_id')
        s3_key = body.get('s3_key')
        metadata = body.get('metadata', {})
        
        if not processing_id or not s3_key:
            print(f"❌ S3_PROCESS: Missing required fields")
            return lambda_response(400, {'error': 'processing_id and s3_key are required'})
        
        # Verify the S3 key belongs to this user
        expected_prefix = f"temp/{user_data['user_id']}/"
        if not s3_key.startswith(expected_prefix):
            print(f"❌ S3_PROCESS: Invalid S3 key for user")
            return lambda_response(403, {'error': 'Access denied to S3 object'})
        
        print(f"✅ S3_PROCESS: Processing request for processing_id: {processing_id}")
        
        # Check if S3 object exists and get metadata
        try:
            response = s3_client.head_object(Bucket=S3_BUCKET_AUDIO, Key=s3_key)
            object_metadata = response.get('Metadata', {})
            file_size = int(response.get('ContentLength', 0))
            
            print(f"✅ S3_PROCESS: S3 object found - size: {file_size} bytes")
            print(f"📊 S3_PROCESS: Object metadata: {object_metadata}")
            
        except s3_client.exceptions.NoSuchKey:
            print(f"❌ S3_PROCESS: S3 object not found: {s3_key}")
            return lambda_response(404, {'error': 'Audio file not found in S3. Please upload first.'})
        except Exception as e:
            print(f"❌ S3_PROCESS: S3 head_object failed: {e}")
            return lambda_response(500, {'error': f'Failed to access S3 object: {str(e)}'})
        
        # Download the audio file from S3 to temporary location
        temp_audio_file = f"/tmp/s3_audio_{processing_id}.pcm"
        
        print(f"🔄 S3_PROCESS: Downloading audio from S3...")
        try:
            s3_client.download_file(S3_BUCKET_AUDIO, s3_key, temp_audio_file)
            downloaded_size = os.path.getsize(temp_audio_file)
            print(f"✅ S3_PROCESS: Audio downloaded successfully - size: {downloaded_size} bytes")
        except Exception as e:
            print(f"❌ S3_PROCESS: S3 download failed: {e}")
            return lambda_response(500, {'error': f'Failed to download audio from S3: {str(e)}'})
        
        # Verify file integrity
        if downloaded_size != file_size:
            print(f"❌ S3_PROCESS: File size mismatch - expected: {file_size}, got: {downloaded_size}")
            return lambda_response(500, {'error': 'Downloaded file size mismatch'})
        
        # Convert PCM to WAV format for AssemblyAI
        print(f"🔄 S3_PROCESS: Converting PCM to WAV format...")
        wav_audio_file = f"/tmp/s3_audio_{processing_id}.wav"
        
        try:
            # Convert raw PCM to WAV using simple header
            sample_rate = 16000
            num_channels = 1
            bits_per_sample = 16
            
            with open(temp_audio_file, 'rb') as pcm_file:
                pcm_data = pcm_file.read()
            
            # Create WAV header
            wav_header = create_wav_header(len(pcm_data), sample_rate, num_channels, bits_per_sample)
            
            with open(wav_audio_file, 'wb') as wav_file:
                wav_file.write(wav_header)
                wav_file.write(pcm_data)
            
            print(f"✅ S3_PROCESS: PCM converted to WAV successfully")
            
        except Exception as e:
            print(f"❌ S3_PROCESS: PCM to WAV conversion failed: {e}")
            return lambda_response(500, {'error': f'Audio format conversion failed: {str(e)}'})
        
        # Create session-like object for processing
        session = {
            'user_id': user_data['user_id'],
            'format': 'pcm16',
            'sample_rate': sample_rate,
            'metadata': {
                **metadata,
                's3_key': s3_key,
                'processing_id': processing_id,
                'file_size_bytes': file_size,
                'processing_method': 'presigned_s3_upload'
            }
        }
        
        # Process the complete audio file (transcribe + summarize)
        print(f"🔄 S3_PROCESS: Starting transcription and summarization...")
        result = process_complete_audio(wav_audio_file, session)
        
        if result.get('success'):
            print(f"✅ S3_PROCESS: Processing completed successfully")
            
            # Deduct credits for successful processing (skip for admin users)
            if not user_data.get('is_admin', False):
                duration_minutes = metadata.get('duration_minutes', 30)
                credits_needed = CREDIT_COSTS.get(f'catchup_{duration_minutes}min', 300)
                
                try:
                    deduct_result = deduct_credits(
                        user_data['user_id'],
                        credits_needed,
                        f'catchup_{duration_minutes}min_s3',
                        {
                            **metadata,
                            'processing_id': processing_id,
                            's3_key': s3_key,
                            'file_size_bytes': file_size,
                            'transcript_length': len(result.get('transcript', ''))
                        }
                    )
                    print(f"✅ S3_PROCESS: Credits deducted: {deduct_result}")
                except Exception as e:
                    print(f"⚠️ S3_PROCESS: Credit deduction failed: {e}")
        
        # Clean up temporary files
        for temp_file in [temp_audio_file, wav_audio_file]:
            try:
                if os.path.exists(temp_file):
                    os.remove(temp_file)
                    print(f"✅ S3_PROCESS: Cleaned up: {temp_file}")
            except Exception as e:
                print(f"⚠️ S3_PROCESS: Cleanup failed for {temp_file}: {e}")
        
        # Clean up S3 file
        try:
            s3_client.delete_object(Bucket=S3_BUCKET_AUDIO, Key=s3_key)
            print(f"✅ S3_PROCESS: S3 object deleted: {s3_key}")
        except Exception as e:
            print(f"⚠️ S3_PROCESS: S3 cleanup failed: {e}")
        
        print(f"✅ S3_PROCESS: All processing completed successfully")
        
        return lambda_response(200, {
            'success': True,
            'data': result,
            'processing_id': processing_id,
            'processing_method': 'presigned_s3_upload'
        })
        
    except json.JSONDecodeError:
        print(f"❌ S3_PROCESS: JSON decode error")
        return lambda_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"❌ S3_PROCESS: Unexpected error: {e}")
        import traceback
        print(f"❌ S3_PROCESS: Traceback: {traceback.format_exc()}")
        return lambda_response(500, {'error': f'Internal server error: {str(e)}'})

def create_wav_header(data_size, sample_rate, num_channels, bits_per_sample):
    """
    Create WAV file header for raw PCM data
    """
    byte_rate = sample_rate * num_channels * bits_per_sample // 8
    block_align = num_channels * bits_per_sample // 8
    
    header = bytearray(44)
    
    # RIFF chunk descriptor
    header[0:4] = b'RIFF'
    header[4:8] = (36 + data_size).to_bytes(4, 'little')  # ChunkSize
    header[8:12] = b'WAVE'
    
    # fmt sub-chunk
    header[12:16] = b'fmt '
    header[16:20] = (16).to_bytes(4, 'little')  # Subchunk1Size (PCM = 16)
    header[20:22] = (1).to_bytes(2, 'little')   # AudioFormat (PCM = 1)
    header[22:24] = num_channels.to_bytes(2, 'little')
    header[24:28] = sample_rate.to_bytes(4, 'little')
    header[28:32] = byte_rate.to_bytes(4, 'little')
    header[32:34] = block_align.to_bytes(2, 'little')
    header[34:36] = bits_per_sample.to_bytes(2, 'little')
    
    # data sub-chunk
    header[36:40] = b'data'
    header[40:44] = data_size.to_bytes(4, 'little')
    
    return bytes(header)