#!/usr/bin/env python3
"""
Simple Extension ID Detection for Live Transcription Chrome Extension

This script helps users find their Chrome extension ID for manual setup.

Usage:
    python3 get_extension_id.py

The script will output the extension ID which you can then use to manually
configure the native messaging manifest.
"""

import os
import json
import platform
from pathlib import Path

def get_chrome_extensions_dir():
    """Get Chrome extensions directory based on operating system"""
    system = platform.system()
    
    if system == "Darwin":  # macOS
        return Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Default" / "Extensions"
    elif system == "Windows":
        return Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data" / "Default" / "Extensions"
    elif system == "Linux":
        return Path.home() / ".config" / "google-chrome" / "Default" / "Extensions"
    else:
        print(f"❌ Unsupported operating system: {system}")
        return None

def find_extension_id():
    """Find the Live Transcription extension ID"""
    extensions_dir = get_chrome_extensions_dir()
    
    if not extensions_dir or not extensions_dir.exists():
        print(f"❌ Chrome extensions directory not found: {extensions_dir}")
        return None
    
    print(f"🔍 Scanning: {extensions_dir}")
    
    for ext_dir in extensions_dir.iterdir():
        if not ext_dir.is_dir() or ext_dir.name.startswith('.'):
            continue
            
        # Look for version subdirectories
        for version_dir in ext_dir.iterdir():
            if not version_dir.is_dir():
                continue
                
            manifest_file = version_dir / "manifest.json"
            if manifest_file.exists():
                try:
                    with open(manifest_file, 'r') as f:
                        manifest = json.load(f)
                        
                    # Check if this is our extension
                    if manifest.get('name') == "Live Transcription Assistant":
                        return ext_dir.name
                        
                except (json.JSONDecodeError, KeyError):
                    continue
    
    return None

def main():
    print("🔍 Live Transcription Extension ID Finder")
    print("=" * 45)
    
    extension_id = find_extension_id()
    
    if extension_id:
        print(f"✅ Found extension ID: {extension_id}")
        print(f"\n📋 Copy this ID and use it in your native messaging setup:")
        print(f"chrome-extension://{extension_id}/")
        print(f"\n🔧 Manual Setup Steps:")
        print(f"1. Edit native_messaging/live_transcription_host.json")
        print(f"2. Replace YOUR_EXTENSION_ID_HERE with: {extension_id}")
        print(f"3. Run: chmod +x native_messaging/host_wrapper.sh")
        print(f"4. Run: chmod +x native_messaging/live_transcription_host.py")
        print(f"5. Restart Chrome")
    else:
        print("❌ Live Transcription extension not found!")
        print("\n💡 Make sure:")
        print("1. The extension is loaded in Chrome")
        print("2. Developer Mode is enabled in chrome://extensions")
        print("3. The extension name is 'Live Transcription Assistant'")

if __name__ == "__main__":
    main()