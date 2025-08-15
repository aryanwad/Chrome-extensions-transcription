#!/usr/bin/env python3
"""
Dynamic Native Messaging Setup for Live Transcription Chrome Extension

This script automatically:
1. Detects the Chrome extension ID from Chrome's extension directory
2. Creates the native messaging manifest with the correct extension ID
3. Sets up all required permissions and paths

Usage:
    python3 setup_native_messaging.py

The script will:
- Find your Chrome profile directory
- Scan for the Live Transcription extension
- Create the native messaging manifest automatically
- Set proper file permissions
"""

import os
import json
import sys
import subprocess
import platform
from pathlib import Path
import shutil

class NativeMessagingSetup:
    def __init__(self):
        self.system = platform.system()
        self.script_dir = Path(__file__).parent.absolute()
        self.extension_name = "Live Transcription Assistant"
        self.host_name = "live_transcription_host"
        
    def get_chrome_extensions_dir(self):
        """Get Chrome extensions directory based on operating system"""
        if self.system == "Darwin":  # macOS
            return Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "Default" / "Extensions"
        elif self.system == "Windows":
            return Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data" / "Default" / "Extensions"
        elif self.system == "Linux":
            return Path.home() / ".config" / "google-chrome" / "Default" / "Extensions"
        else:
            raise Exception(f"Unsupported operating system: {self.system}")
    
    def get_native_messaging_dir(self):
        """Get native messaging hosts directory"""
        if self.system == "Darwin":  # macOS
            return Path.home() / "Library" / "Application Support" / "Google" / "Chrome" / "NativeMessagingHosts"
        elif self.system == "Windows":
            return Path.home() / "AppData" / "Local" / "Google" / "Chrome" / "User Data" / "NativeMessagingHosts"
        elif self.system == "Linux":
            return Path.home() / ".config" / "google-chrome" / "NativeMessagingHosts"
        else:
            raise Exception(f"Unsupported operating system: {self.system}")
    
    def find_extension_id(self):
        """Find the extension ID by scanning Chrome's extensions directory"""
        extensions_dir = self.get_chrome_extensions_dir()
        
        if not extensions_dir.exists():
            print(f"❌ Chrome extensions directory not found: {extensions_dir}")
            return None
        
        print(f"🔍 Scanning Chrome extensions directory: {extensions_dir}")
        
        # Scan all extension directories
        for ext_dir in extensions_dir.iterdir():
            if not ext_dir.is_dir():
                continue
                
            # Skip system extensions (start with internal characters)
            if ext_dir.name.startswith('.'):
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
                        if manifest.get('name') == self.extension_name:
                            print(f"✅ Found Live Transcription extension!")
                            print(f"   Extension ID: {ext_dir.name}")
                            print(f"   Version: {version_dir.name}")
                            print(f"   Path: {version_dir}")
                            return ext_dir.name
                            
                    except (json.JSONDecodeError, KeyError) as e:
                        # Skip invalid manifests
                        continue
        
        print(f"❌ Live Transcription extension not found in Chrome extensions.")
        print(f"   Make sure the extension is loaded in Chrome Developer Mode.")
        return None
    
    def create_native_messaging_manifest(self, extension_id):
        """Create the native messaging manifest with the detected extension ID"""
        
        # Get paths
        native_messaging_dir = self.get_native_messaging_dir()
        host_script_path = self.script_dir / "native_messaging" / "host_wrapper.sh"
        
        # Ensure native messaging directory exists
        native_messaging_dir.mkdir(parents=True, exist_ok=True)
        
        # Create manifest content
        manifest_content = {
            "name": self.host_name,
            "description": "Native messaging host for Live Transcription catch-up processing",
            "path": str(host_script_path.absolute()),
            "type": "stdio",
            "allowed_origins": [
                f"chrome-extension://{extension_id}/"
            ]
        }
        
        # Write manifest file
        manifest_path = native_messaging_dir / f"{self.host_name}.json"
        
        print(f"📝 Creating native messaging manifest:")
        print(f"   Path: {manifest_path}")
        print(f"   Extension ID: {extension_id}")
        
        with open(manifest_path, 'w') as f:
            json.dump(manifest_content, f, indent=2)
        
        print(f"✅ Native messaging manifest created successfully!")
        return manifest_path
    
    def setup_permissions(self):
        """Set up proper file permissions for the native messaging scripts"""
        
        # Make host scripts executable
        scripts_to_make_executable = [
            self.script_dir / "native_messaging" / "host_wrapper.sh",
            self.script_dir / "native_messaging" / "live_transcription_host.py"
        ]
        
        for script_path in scripts_to_make_executable:
            if script_path.exists():
                print(f"🔧 Making executable: {script_path}")
                script_path.chmod(0o755)
            else:
                print(f"⚠️  Script not found: {script_path}")
    
    def check_dependencies(self):
        """Check if required Python dependencies are installed"""
        required_packages = ['yt-dlp', 'requests', 'openai']
        missing_packages = []
        
        for package in required_packages:
            try:
                __import__(package.replace('-', '_'))
                print(f"✅ {package} is installed")
            except ImportError:
                missing_packages.append(package)
                print(f"❌ {package} is missing")
        
        if missing_packages:
            print(f"\n📦 Install missing packages with:")
            print(f"pip3 install {' '.join(missing_packages)}")
            return False
        
        return True
    
    def run_setup(self):
        """Run the complete setup process"""
        print("🚀 Live Transcription Native Messaging Setup")
        print("=" * 50)
        
        # Check dependencies first
        print("\n1. Checking Python dependencies...")
        if not self.check_dependencies():
            print("\n❌ Please install missing dependencies first!")
            return False
        
        # Find extension ID
        print("\n2. Detecting Chrome extension ID...")
        extension_id = self.find_extension_id()
        
        if not extension_id:
            print("\n💡 Setup Instructions:")
            print("   1. Load the Chrome extension in Developer Mode")
            print("   2. Go to chrome://extensions/")
            print("   3. Find 'Live Transcription Assistant' and enable Developer Mode")
            print("   4. Run this script again")
            return False
        
        # Create manifest
        print("\n3. Creating native messaging manifest...")
        manifest_path = self.create_native_messaging_manifest(extension_id)
        
        # Set permissions
        print("\n4. Setting up file permissions...")
        self.setup_permissions()
        
        print("\n🎉 Setup Complete!")
        print("=" * 50)
        print(f"✅ Extension ID detected: {extension_id}")
        print(f"✅ Native messaging manifest: {manifest_path}")
        print(f"✅ File permissions configured")
        print(f"\n🔄 Please restart Chrome for changes to take effect.")
        print(f"🧪 You can now test the catch-up feature!")
        
        return True

def main():
    setup = NativeMessagingSetup()
    
    if len(sys.argv) > 1 and sys.argv[1] == '--help':
        print(__doc__)
        return
    
    try:
        success = setup.run_setup()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"💥 Setup failed: {e}")
        sys.exit(1)

if __name__ == "__main__":
    main()