#!/usr/bin/env python3
"""
Test script for the catch-up API functionality
"""
import asyncio
import aiohttp
import json
import time

async def test_catchup_api():
    """Test the complete catch-up API flow"""
    base_url = "http://localhost:8000"
    
    print("🧪 Testing Live Transcription Catch-Up API...")
    print("=" * 50)
    
    async with aiohttp.ClientSession() as session:
        # Test 1: Health check
        print("1️⃣ Testing health check...")
        try:
            async with session.get(f"{base_url}/") as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"✅ Health check passed: {data['service']}")
                else:
                    print(f"❌ Health check failed: {response.status}")
                    return
        except Exception as e:
            print(f"❌ Health check failed: {str(e)}")
            return
        
        # Test 2: Start catch-up request
        print("\n2️⃣ Testing catch-up request...")
        test_request = {
            "stream_url": "https://twitch.tv/teststream",
            "duration_minutes": 30,
            "user_id": "test-user"
        }
        
        try:
            async with session.post(
                f"{base_url}/api/catchup",
                json=test_request
            ) as response:
                if response.status == 200:
                    data = await response.json()
                    task_id = data["task_id"]
                    print(f"✅ Catch-up request initiated: {task_id}")
                    print(f"📊 Estimated time: {data.get('estimated_time', 'N/A')}")
                else:
                    error_data = await response.text()
                    print(f"❌ Catch-up request failed: {response.status} - {error_data}")
                    return
        except Exception as e:
            print(f"❌ Catch-up request failed: {str(e)}")
            return
        
        # Test 3: Poll for status updates
        print(f"\n3️⃣ Testing status polling for task: {task_id}")
        max_polls = 20
        poll_count = 0
        
        while poll_count < max_polls:
            try:
                await asyncio.sleep(3)  # Wait 3 seconds between polls
                poll_count += 1
                
                async with session.get(f"{base_url}/api/catchup/{task_id}/status") as response:
                    if response.status == 200:
                        data = await response.json()
                        status = data["status"]
                        progress = data["progress"]
                        message = data["message"]
                        
                        print(f"📊 Poll {poll_count}: {status} ({progress}%) - {message}")
                        
                        if status == "complete":
                            print("✅ Task completed successfully!")
                            result = data.get("result", {})
                            if result:
                                print(f"📝 Summary length: {len(result.get('summary', ''))}")
                                print(f"🎬 Clips processed: {result.get('clipsProcessed', 0)}")
                                print(f"⏱️ Processing time: {result.get('processingTime', 0)}s")
                            break
                        elif status == "failed":
                            print("❌ Task failed!")
                            break
                    else:
                        print(f"❌ Status check failed: {response.status}")
                        break
            except Exception as e:
                print(f"❌ Status polling error: {str(e)}")
                break
        
        if poll_count >= max_polls:
            print("⏱️ Polling timed out")
        
        # Test 4: List active tasks
        print("\n4️⃣ Testing active tasks endpoint...")
        try:
            async with session.get(f"{base_url}/api/tasks") as response:
                if response.status == 200:
                    data = await response.json()
                    print(f"📋 Active tasks: {data['active_tasks']}")
                    for task_id, task_info in data.get('tasks', {}).items():
                        print(f"   🔹 {task_id}: {task_info['status']} ({task_info['progress']}%)")
                else:
                    print(f"❌ Active tasks check failed: {response.status}")
        except Exception as e:
            print(f"❌ Active tasks check failed: {str(e)}")

if __name__ == "__main__":
    print("🚀 Starting catch-up API test...")
    print("⚠️ Make sure the backend server is running on localhost:8000")
    print("💡 Run: ./start.sh or python main.py")
    print()
    
    try:
        asyncio.run(test_catchup_api())
    except KeyboardInterrupt:
        print("\n⏹️ Test interrupted by user")
    except Exception as e:
        print(f"\n❌ Test failed with error: {str(e)}")
    
    print("\n🏁 Test completed!")