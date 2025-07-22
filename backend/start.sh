#!/bin/bash

# Start script for Live Transcription Catch-Up Backend

echo "🚀 Starting Live Transcription Catch-Up Backend..."

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
echo "🔧 Activating virtual environment..."
source venv/bin/activate

# Install dependencies
echo "📚 Installing dependencies..."
pip install -r requirements.txt

# Start the server
echo "✅ Starting FastAPI server on http://localhost:8000"
echo "📊 API Documentation: http://localhost:8000/docs"
echo "🔄 Health Check: http://localhost:8000"
echo ""
echo "Press Ctrl+C to stop the server"

python main.py