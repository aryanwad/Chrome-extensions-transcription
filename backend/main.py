#!/usr/bin/env python3
"""
Live Transcription Catch-Up Backend API
FastAPI server for processing stream catch-up requests with parallel processing
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import asyncio
import uuid
import time
import logging
from typing import Dict, Optional, List
from datetime import datetime
import json

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize FastAPI app
app = FastAPI(
    title="Live Transcription Catch-Up API",
    description="Backend service for processing stream catch-up requests",
    version="1.0.0"
)

# Add CORS middleware to allow Chrome extension requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "chrome-extension://*",
        "http://localhost:*",
        "https://localhost:*",
        "moz-extension://*",  # Firefox support
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["*"],
    expose_headers=["*"],
)

# Global task storage (in production, use Redis or database)
active_tasks: Dict[str, Dict] = {}

# Pydantic models
class CatchupRequest(BaseModel):
    stream_url: str
    duration_minutes: int
    user_id: str = "anonymous"

class TaskStatus(BaseModel):
    task_id: str
    status: str
    progress: int
    message: str
    result: Optional[Dict] = None

# Import processing modules
from stream_processor import StreamProcessor
from parallel_transcriber import ParallelTranscriber

# Initialize services
stream_processor = StreamProcessor()
parallel_transcriber = ParallelTranscriber()

@app.get("/")
async def root():
    """Health check endpoint"""
    return {
        "service": "Live Transcription Catch-Up API",
        "status": "running",
        "version": "1.0.0",
        "active_tasks": len(active_tasks),
        "timestamp": datetime.now().isoformat()
    }

@app.post("/api/catchup")
async def request_catchup(request: CatchupRequest, background_tasks: BackgroundTasks):
    """
    Start a catch-up processing request
    """
    logger.info(f"🎯 CATCHUP REQUEST: {request.stream_url} ({request.duration_minutes}min)")
    
    # Generate unique task ID
    task_id = str(uuid.uuid4())
    
    # Validate request
    if request.duration_minutes not in [30, 60]:
        raise HTTPException(400, "Duration must be 30 or 60 minutes")
    
    if not _is_valid_stream_url(request.stream_url):
        raise HTTPException(400, "Unsupported stream platform")
    
    # Initialize task
    task_info = {
        "task_id": task_id,
        "status": "initialized",
        "progress": 0,
        "message": "Task initialized",
        "stream_url": request.stream_url,
        "duration_minutes": request.duration_minutes,
        "user_id": request.user_id,
        "created_at": datetime.now().isoformat(),
        "result": None
    }
    
    active_tasks[task_id] = task_info
    
    # Start background processing
    background_tasks.add_task(process_catchup_async, task_id)
    
    logger.info(f"✅ CATCHUP INITIATED: Task {task_id}")
    
    return {
        "task_id": task_id,
        "status": "processing",
        "estimated_time": "60-90 seconds"
    }

@app.get("/api/catchup/{task_id}/status")
async def get_catchup_status(task_id: str):
    """
    Get the status of a catch-up processing task
    """
    if task_id not in active_tasks:
        raise HTTPException(404, "Task not found")
    
    task_info = active_tasks[task_id]
    
    return {
        "task_id": task_id,
        "status": task_info["status"],
        "progress": task_info["progress"],
        "message": task_info["message"],
        "result": task_info.get("result"),
        "created_at": task_info["created_at"],
        "duration_minutes": task_info["duration_minutes"]
    }

@app.get("/api/tasks")
async def list_active_tasks():
    """
    List all active tasks (for debugging)
    """
    return {
        "active_tasks": len(active_tasks),
        "tasks": {
            task_id: {
                "status": task["status"],
                "progress": task["progress"],
                "created_at": task["created_at"],
                "duration_minutes": task["duration_minutes"]
            }
            for task_id, task in active_tasks.items()
        }
    }

async def process_catchup_async(task_id: str):
    """
    Background task to process catch-up request with parallel processing
    """
    start_time = time.time()
    logger.info(f"🚀 PROCESSING START: Task {task_id}")
    
    try:
        task = active_tasks[task_id]
        stream_url = task["stream_url"]
        duration_minutes = task["duration_minutes"]
        
        # Update status: Starting
        await update_task_status(task_id, "extracting_stream", 10, "Analyzing stream...")
        
        # Step 1: Extract stream information and create clips (parallel)
        logger.info(f"📹 STREAM EXTRACTION: {stream_url}")
        clips = await stream_processor.create_parallel_clips(stream_url, duration_minutes)
        
        if not clips:
            raise Exception("No clips could be extracted from stream")
        
        logger.info(f"✅ CLIPS CREATED: {len(clips)} clips for processing")
        await update_task_status(task_id, "transcribing", 40, f"Transcribing {len(clips)} clips...")
        
        # Step 2: Parallel transcription of all clips
        logger.info(f"🎤 PARALLEL TRANSCRIPTION: Processing {len(clips)} clips")
        transcripts = await parallel_transcriber.transcribe_clips_parallel(clips)
        
        logger.info(f"✅ TRANSCRIPTION COMPLETE: {len(transcripts)} transcripts processed")
        await update_task_status(task_id, "summarizing", 80, "Generating AI summary...")
        
        # Step 3: AI summarization
        logger.info(f"🤖 AI SUMMARIZATION: Generating summary")
        combined_transcript = merge_transcripts(transcripts)
        summary = await generate_ai_summary(combined_transcript, stream_url, duration_minutes)
        
        # Processing complete
        processing_time = round(time.time() - start_time, 2)
        
        result = {
            "summary": summary,
            "fullTranscript": combined_transcript[:5000],  # Limit to 5000 chars
            "clipsProcessed": len(clips),
            "duration": duration_minutes,
            "processingTime": processing_time,
            "streamUrl": stream_url
        }
        
        await update_task_status(task_id, "complete", 100, "Summary generated successfully!", result)
        
        logger.info(f"✅ PROCESSING COMPLETE: Task {task_id} in {processing_time}s")
        
        # Cleanup task after 10 minutes
        await asyncio.sleep(600)
        if task_id in active_tasks:
            del active_tasks[task_id]
            logger.info(f"🧹 CLEANUP: Removed task {task_id}")
            
    except Exception as e:
        logger.error(f"❌ PROCESSING FAILED: Task {task_id} - {str(e)}")
        await update_task_status(task_id, "failed", 0, f"Error: {str(e)}")

async def update_task_status(task_id: str, status: str, progress: int, message: str, result: Optional[Dict] = None):
    """Update task status"""
    if task_id in active_tasks:
        active_tasks[task_id].update({
            "status": status,
            "progress": progress,
            "message": message,
            "updated_at": datetime.now().isoformat()
        })
        
        if result:
            active_tasks[task_id]["result"] = result
        
        logger.info(f"📊 STATUS UPDATE: {task_id} - {status} ({progress}%): {message}")

def merge_transcripts(transcripts: List[Dict]) -> str:
    """Merge multiple transcript segments into one"""
    # Sort by timestamp/index
    sorted_transcripts = sorted(transcripts, key=lambda x: x.get('index', 0))
    
    # Combine text
    combined_text = ' '.join([
        transcript.get('text', '')
        for transcript in sorted_transcripts
        if transcript.get('text', '').strip()
    ])
    
    return combined_text.strip()

async def generate_ai_summary(transcript: str, stream_url: str, duration_minutes: int) -> str:
    """Generate AI summary using OpenAI GPT-4"""
    
    # Detect platform
    platform = "Unknown"
    if "twitch.tv" in stream_url:
        platform = "Twitch"
    elif "youtube.com" in stream_url or "youtu.be" in stream_url:
        platform = "YouTube"
    elif "kick.com" in stream_url:
        platform = "Kick"
    
    # If transcript is empty or too short, return basic summary
    if not transcript.strip() or len(transcript.strip()) < 100:
        logger.warning(f"📝 SHORT_TRANSCRIPT: Using basic summary for {platform} stream")
        return f"""
🎮 **{platform} Stream Summary** ({duration_minutes} minutes)

**⚠️ Limited Content Available**
The stream transcript was too short for detailed analysis. This may be due to:
• Limited audio content during the selected time period
• Technical issues with audio extraction
• Stream may have been in "Just Chatting" or low-activity mode

**📊 Stream Stats:**
• Duration analyzed: {duration_minutes} minutes
• Platform: {platform}
• Processing completed successfully

*Try selecting a different time period with more active content for better results.*
        """.strip()
    
    try:
        # Real OpenAI integration
        logger.info(f"🤖 OPENAI: Generating AI summary for {len(transcript)} characters")
        
        # OpenAI API key (same as extension)
        openai_api_key = "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"
        
        # Create prompt for GPT-4
        prompt = f"""
You are an expert stream summarizer. Analyze this {platform} stream transcript and provide a comprehensive summary.

Stream Details:
- Platform: {platform}
- Duration: {duration_minutes} minutes
- Transcript Length: {len(transcript)} characters

Transcript:
{transcript[:4000]}{"..." if len(transcript) > 4000 else ""}

Please provide a summary in this format:

🎮 **{platform} Stream Summary** ({duration_minutes} minutes)

**🔥 Key Events:**
• [List 3-4 main events or topics discussed]

**💬 Notable Moments:**
• [Highlight 2-3 interesting or memorable moments]

**🎯 For New Viewers:**
[Brief explanation of what happened and the general tone/content]

**📊 Stream Stats:**
• Duration analyzed: {duration_minutes} minutes
• Main topics: [2-3 key topics]
• Activity level: [High/Medium/Low based on content]

Keep it concise, engaging, and helpful for someone who missed the stream.
        """
        
        # Make OpenAI API call
        async with aiohttp.ClientSession() as session:
            async with session.post(
                'https://api.openai.com/v1/chat/completions',
                headers={
                    'Authorization': f'Bearer {openai_api_key}',
                    'Content-Type': 'application/json'
                },
                json={
                    'model': 'gpt-4',
                    'messages': [
                        {
                            'role': 'user',
                            'content': prompt
                        }
                    ],
                    'max_tokens': 800,
                    'temperature': 0.7
                }
            ) as response:
                if response.status == 200:
                    result = await response.json()
                    summary = result['choices'][0]['message']['content'].strip()
                    logger.info(f"✅ OPENAI: AI summary generated successfully")
                    return summary
                else:
                    error_text = await response.text()
                    logger.error(f"❌ OPENAI: API error {response.status}: {error_text}")
                    raise Exception(f"OpenAI API error: {response.status}")
                    
    except Exception as e:
        logger.error(f"❌ OPENAI: Failed to generate AI summary: {str(e)}")
        
        # Fallback to basic summary
        logger.info(f"🔄 FALLBACK: Using basic summary structure")
        return f"""
🎮 **{platform} Stream Summary** ({duration_minutes} minutes)

**🔥 Key Events:**
• Stream content was successfully transcribed
• Multiple segments of activity detected
• Content included dialogue and interaction

**💬 Notable Moments:**
• Transcript contains {len(transcript.split())} words of content
• Stream duration covers {duration_minutes} minutes of activity

**🎯 For New Viewers:**
This {platform} stream had active content during the analyzed period. Full AI analysis temporarily unavailable.

**📊 Stream Stats:**
• Duration analyzed: {duration_minutes} minutes
• Transcript length: {len(transcript)} characters
• Processing completed: {datetime.now().strftime('%H:%M:%S')}

*AI summary generation encountered an issue but transcript processing was successful.*
        """.strip()

def _is_valid_stream_url(url: str) -> bool:
    """Validate if the stream URL is from a supported platform"""
    supported_platforms = [
        'twitch.tv',
        'youtube.com',
        'youtu.be',
        'kick.com'
    ]
    
    return any(platform in url for platform in supported_platforms)

if __name__ == "__main__":
    import uvicorn
    logger.info("🚀 Starting Live Transcription Catch-Up API Server")
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")