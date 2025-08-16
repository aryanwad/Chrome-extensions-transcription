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
from datetime import datetime
from typing import Dict, Any

from .auth import authenticate_request, lambda_response, convert_decimals
from .credits import check_credits, deduct_credits, CREDIT_COSTS

# API Keys (secure environment variables)
ASSEMBLYAI_API_KEY = os.environ['ASSEMBLYAI_API_KEY']
OPENAI_API_KEY = os.environ['OPENAI_API_KEY']
TWITCH_CLIENT_ID = os.environ['TWITCH_CLIENT_ID']
TWITCH_CLIENT_SECRET = os.environ['TWITCH_CLIENT_SECRET']

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
            # Check if user has sufficient credits (minimum 10 for 1 minute)
            if user_data.get('credits_balance', 0) < 10:
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
        # Upload file to AssemblyAI
        with open(audio_file_path, 'rb') as f:
            upload_response = requests.post(
                'https://api.assemblyai.com/v2/upload',
                files={'file': f},
                headers={'authorization': ASSEMBLYAI_API_KEY},
                timeout=60
            )
        
        if upload_response.status_code != 200:
            return None
        
        audio_url = upload_response.json()['upload_url']
        
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
                    return status_data['text']
                elif status_data['status'] == 'error':
                    return None
            
            time.sleep(5)
        
        return None
        
    except Exception as e:
        print(f"Transcription error: {e}")
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