// Setup helper for displaying extension ID to users
// This can be included in the popup or as a separate setup page

class ExtensionSetupHelper {
  constructor() {
    this.extensionId = chrome.runtime.id;
  }
  
  getExtensionId() {
    return this.extensionId;
  }
  
  getSetupInstructions() {
    return {
      extensionId: this.extensionId,
      manifestContent: this.generateManifestContent(),
      setupSteps: this.getSetupSteps()
    };
  }
  
  generateManifestContent() {
    const scriptDir = "/path/to/final_live_transcribe"; // User needs to update this
    
    return {
      "name": "live_transcription_host",
      "description": "Native messaging host for Live Transcription catch-up processing", 
      "path": `${scriptDir}/native_messaging/host_wrapper.sh`,
      "type": "stdio",
      "allowed_origins": [
        `chrome-extension://${this.extensionId}/`
      ]
    };
  }
  
  getSetupSteps() {
    const system = this.detectOS();
    const nativeMessagingPath = this.getNativeMessagingPath(system);
    
    return [
      {
        step: 1,
        title: "Install Python Dependencies",
        command: "pip3 install yt-dlp requests openai",
        description: "Install required Python packages for local processing"
      },
      {
        step: 2,
        title: "Create Native Messaging Directory",
        command: `mkdir -p "${nativeMessagingPath}"`,
        description: "Create the native messaging hosts directory"
      },
      {
        step: 3,
        title: "Create Manifest File",
        file: `${nativeMessagingPath}/live_transcription_host.json`,
        content: JSON.stringify(this.generateManifestContent(), null, 2),
        description: "Create the native messaging manifest with your extension ID"
      },
      {
        step: 4,
        title: "Set File Permissions",
        commands: [
          "chmod +x native_messaging/host_wrapper.sh",
          "chmod +x native_messaging/live_transcription_host.py"
        ],
        description: "Make the native messaging scripts executable"
      },
      {
        step: 5,
        title: "Restart Chrome",
        description: "Restart Chrome completely for native messaging to take effect"
      }
    ];
  }
  
  detectOS() {
    const userAgent = navigator.userAgent;
    if (userAgent.indexOf("Mac") !== -1) return "mac";
    if (userAgent.indexOf("Win") !== -1) return "windows"; 
    if (userAgent.indexOf("Linux") !== -1) return "linux";
    return "unknown";
  }
  
  getNativeMessagingPath(os) {
    switch(os) {
      case "mac":
        return "~/Library/Application Support/Google/Chrome/NativeMessagingHosts";
      case "windows":
        return "~/AppData/Local/Google/Chrome/User Data/NativeMessagingHosts";
      case "linux":
        return "~/.config/google-chrome/NativeMessagingHosts";
      default:
        return "[OS_SPECIFIC_PATH]";
    }
  }
  
  displaySetupInPopup() {
    const instructions = this.getSetupInstructions();
    
    // Create setup UI
    const setupDiv = document.createElement('div');
    setupDiv.innerHTML = `
      <div class="setup-instructions">
        <h3>🔧 Native Messaging Setup Required</h3>
        <p><strong>Your Extension ID:</strong> <code>${instructions.extensionId}</code></p>
        
        <div class="setup-option">
          <h4>Option 1: Automatic Setup (Recommended)</h4>
          <p>Run this command in your project directory:</p>
          <code>python3 setup_native_messaging.py</code>
        </div>
        
        <div class="setup-option">
          <h4>Option 2: Manual Setup</h4>
          <p>Follow these steps:</p>
          <ol>
            ${instructions.setupSteps.map(step => `
              <li>
                <strong>${step.title}</strong><br>
                ${step.command ? `<code>${step.command}</code><br>` : ''}
                ${step.commands ? step.commands.map(cmd => `<code>${cmd}</code>`).join('<br>') + '<br>' : ''}
                ${step.file ? `<strong>File:</strong> <code>${step.file}</code><br>` : ''}
                <em>${step.description}</em>
              </li>
            `).join('')}
          </ol>
        </div>
        
        <button id="copy-extension-id" class="setup-button">📋 Copy Extension ID</button>
        <button id="test-native-messaging" class="setup-button">🧪 Test Setup</button>
      </div>
    `;
    
    return setupDiv;
  }
  
  copyExtensionIdToClipboard() {
    navigator.clipboard.writeText(this.extensionId).then(() => {
      console.log('Extension ID copied to clipboard');
    });
  }
  
  async testNativeMessaging() {
    try {
      const port = chrome.runtime.connectNative('live_transcription_host');
      
      return new Promise((resolve) => {
        const timeout = setTimeout(() => {
          resolve({success: false, error: 'Connection timeout'});
        }, 5000);
        
        port.onMessage.addListener((response) => {
          clearTimeout(timeout);
          resolve({success: true, response});
        });
        
        port.onDisconnect.addListener(() => {
          clearTimeout(timeout);
          resolve({success: false, error: chrome.runtime.lastError?.message || 'Connection failed'});
        });
        
        port.postMessage({type: 'test', data: 'Setup test'});
      });
      
    } catch (error) {
      return {success: false, error: error.message};
    }
  }
}

// Make available globally
window.ExtensionSetupHelper = ExtensionSetupHelper;