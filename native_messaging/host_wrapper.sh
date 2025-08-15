#!/bin/bash
# Chrome Native Messaging Host Wrapper
# Ensures proper environment for Python script execution

# Set PATH to include common Python locations
export PATH="/usr/bin:/usr/local/bin:/opt/homebrew/bin:$PATH"

# Execute the Python script with the system Python
exec /usr/bin/python3 "/Users/aryanwad/final_live_transcribe/native_messaging/live_transcription_host.py" "$@"