// Popup script for Live Transcription Assistant with Authentication
class PopupController {
  constructor() {
    this.backendUrl = 'https://gak2qkt4df.execute-api.us-east-1.amazonaws.com/dev';
    this.currentUser = null;
    this.isTranscribing = false;
    this.creditsUpdateInterval = null;
    
    this.elements = {
      // Login/Signup sections
      loginSection: document.getElementById('login-section'),
      dashboardSection: document.getElementById('dashboard-section'),
      creditPackagesSection: document.getElementById('credit-packages-section'),
      
      // Login form
      loginForm: document.getElementById('login-form'),
      signupForm: document.getElementById('signup-form'),
      loginStatus: document.getElementById('login-status'),
      
      // Login fields
      email: document.getElementById('email'),
      password: document.getElementById('password'),
      loginBtn: document.getElementById('login-btn'),
      showSignup: document.getElementById('show-signup'),
      showLogin: document.getElementById('show-login'),
      
      // Signup fields
      signupName: document.getElementById('signup-name'),
      signupEmail: document.getElementById('signup-email'),
      signupPassword: document.getElementById('signup-password'),
      signupBtn: document.getElementById('signup-btn'),
      
      // Dashboard elements
      creditsBalance: document.getElementById('credits-balance'),
      buyCredits: document.getElementById('buy-credits'),
      logoutBtn: document.getElementById('logout-btn'),
      
      // Package selection
      backToDashboard: document.getElementById('back-to-dashboard'),
      
      // Transcription controls
      controlSection: document.getElementById('control-section'),
      transcriptionStatus: document.getElementById('transcription-status'),
      startTranscription: document.getElementById('start-transcription'),
      stopTranscription: document.getElementById('stop-transcription'),
      
    };
    
    this.init();
  }
  
  async init() {
    this.setupEventListeners();
    await this.checkAuthStatus();
    this.checkTranscriptionStatus();
    
    // Cleanup intervals when popup is closed
    window.addEventListener('beforeunload', () => {
      this.stopCreditsUpdateInterval();
    });
  }
  
  setupEventListeners() {
    // Login/Signup form toggles
    this.elements.showSignup.addEventListener('click', () => {
      this.elements.loginForm.classList.add('hidden');
      this.elements.signupForm.classList.remove('hidden');
    });
    
    this.elements.showLogin.addEventListener('click', () => {
      this.elements.signupForm.classList.add('hidden');
      this.elements.loginForm.classList.remove('hidden');
    });
    
    // Authentication actions
    this.elements.loginBtn.addEventListener('click', () => this.login());
    this.elements.signupBtn.addEventListener('click', () => this.signup());
    this.elements.logoutBtn.addEventListener('click', () => this.logout());
    
    // Transcription controls
    this.elements.startTranscription.addEventListener('click', () => this.startTranscription());
    this.elements.stopTranscription.addEventListener('click', () => this.stopTranscription());
    
    // Credits and package selection
    this.elements.buyCredits.addEventListener('click', () => this.showCreditPackages());
    this.elements.backToDashboard.addEventListener('click', () => this.showDashboard());
    
    // Package button event listeners (using event delegation)
    document.addEventListener('click', (e) => {
      if (e.target.classList.contains('package-btn')) {
        const packageId = e.target.getAttribute('data-package-id');
        this.buyCredits(packageId);
      }
    });
    
    // Enter key support for login
    this.elements.email.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });
    
    this.elements.password.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.login();
    });
    
    // Enter key support for signup
    this.elements.signupPassword.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') this.signup();
    });
  }
  
  async checkAuthStatus() {
    try {
      const userAuth = await this.getUserAuth();
      if (userAuth && userAuth.token) {
        // Verify token is still valid
        const userInfo = await this.apiCall('/auth/user', 'GET', null, userAuth.token);
        if (userInfo) {
          this.currentUser = userInfo;
          this.showDashboard();
          await this.loadCreditsBalance();
        } else {
          // Token invalid, clear auth
          await this.clearUserAuth();
          this.showLogin();
        }
      } else {
        this.showLogin();
      }
    } catch (error) {
      console.error('Auth check failed:', error);
      this.showLogin();
    }
  }
  
  async login() {
    const email = this.elements.email.value.trim();
    const password = this.elements.password.value.trim();
    
    if (!email || !password) {
      this.showLoginStatus('Please enter both email and password', 'error');
      return;
    }
    
    try {
      this.setLoginLoading(true);
      
      const response = await this.apiCall('/auth/login', 'POST', {
        email,
        password
      });
      
      if (response && response.user && response.user.token) {
        // Save auth data
        await this.saveUserAuth({
          token: response.user.token,
          user: response.user
        });
        
        this.currentUser = response.user;
        this.showDashboard();
        await this.loadCreditsBalance();
        this.showLoginStatus('Login successful!', 'success');
      } else {
        this.showLoginStatus('Invalid email or password', 'error');
      }
    } catch (error) {
      console.error('Login error:', error);
      this.showLoginStatus('Login failed: ' + error.message, 'error');
    } finally {
      this.setLoginLoading(false);
    }
  }
  
  async signup() {
    const name = this.elements.signupName.value.trim();
    const email = this.elements.signupEmail.value.trim();
    const password = this.elements.signupPassword.value.trim();
    
    if (!name || !email || !password) {
      this.showLoginStatus('Please fill in all fields', 'error');
      return;
    }
    
    if (password.length < 8) {
      this.showLoginStatus('Password must be at least 8 characters', 'error');
      return;
    }
    
    try {
      this.setSignupLoading(true);
      
      const response = await this.apiCall('/auth/register', 'POST', {
        name,
        email,
        password
      });
      
      if (response && response.user && response.user.token) {
        // Save auth data
        await this.saveUserAuth({
          token: response.user.token,
          user: response.user
        });
        
        this.currentUser = response.user;
        this.showDashboard();
        await this.loadCreditsBalance();
        this.showLoginStatus('Account created successfully! You received 200 free credits!', 'success');
      } else {
        this.showLoginStatus('Account creation failed', 'error');
      }
    } catch (error) {
      console.error('Signup error:', error);
      if (error.message.includes('email already exists')) {
        this.showLoginStatus('An account with this email already exists', 'error');
      } else {
        this.showLoginStatus('Signup failed: ' + error.message, 'error');
      }
    } finally {
      this.setSignupLoading(false);
    }
  }
  
  async logout() {
    await this.clearUserAuth();
    this.currentUser = null;
    this.showLogin();
    this.clearForms();
    this.showLoginStatus('Logged out successfully', 'success');
  }
  
  async loadCreditsBalance() {
    try {
      const userAuth = await this.getUserAuth();
      if (!userAuth || !userAuth.token) return;
      
      const response = await this.apiCall('/credits/balance', 'GET', null, userAuth.token);
      if (response && typeof response.balance === 'number') {
        // Show unlimited for admin users
        if (this.currentUser && this.currentUser.is_admin) {
          this.elements.creditsBalance.textContent = '∞ UNLIMITED';
        } else {
          this.elements.creditsBalance.textContent = response.balance.toLocaleString();
        }
        
        // Enable/disable transcription based on credits (admin always enabled)
        if (response.balance > 0 || (this.currentUser && this.currentUser.is_admin)) {
          this.elements.startTranscription.disabled = false;
          this.updateInstructions('2. Navigate to a tab with audio content');
        } else {
          this.elements.startTranscription.disabled = true;
          this.updateInstructions('2. You need credits to start transcription');
        }
      }
    } catch (error) {
      console.error('Failed to load credits balance:', error);
      this.elements.creditsBalance.textContent = 'Error';
    }
  }
  
  showCreditPackages() {
    this.elements.dashboardSection.classList.add('hidden');
    this.elements.creditPackagesSection.classList.remove('hidden');
  }
  
  showDashboard() {
    // Hide all other sections
    this.elements.loginSection.classList.add('hidden');
    this.elements.creditPackagesSection.classList.add('hidden');
    this.elements.dashboardSection.classList.remove('hidden');

    // Note: User info display removed for cleaner UI
  }
  
  async buyCredits(packageId) {
    try {
      const userAuth = await this.getUserAuth();
      if (!userAuth || !userAuth.token) return;
      
      if (!packageId) {
        throw new Error('Please select a credit package');
      }
      
      // Disable all package buttons
      const packageBtns = document.querySelectorAll('.package-btn');
      packageBtns.forEach(btn => {
        btn.disabled = true;
        if (btn.getAttribute('data-package-id') === packageId) {
          btn.innerHTML = '<span class="loading"></span>Creating checkout...';
        }
      });
      
      const response = await this.apiCall('/credits/purchase', 'POST', {
        package_id: packageId
      }, userAuth.token);
      
      if (response && response.checkout_url) {
        // Open Stripe checkout in new tab
        chrome.tabs.create({ url: response.checkout_url });
        this.showDashboard();
        this.showTranscriptionStatus('Checkout opened in new tab. Credits will be added after payment.', 'success');
      } else {
        throw new Error(response?.error || 'Failed to create checkout session');
      }
    } catch (error) {
      console.error('Purchase error:', error);
      this.showTranscriptionStatus('Purchase failed: ' + error.message, 'error');
    } finally {
      // Re-enable all package buttons
      const packageBtns = document.querySelectorAll('.package-btn');
      packageBtns.forEach(btn => {
        btn.disabled = false;
        const packageId = btn.getAttribute('data-package-id');
        btn.textContent = `Choose ${packageId.charAt(0).toUpperCase() + packageId.slice(1)}`;
      });
    }
  }
  
  async startTranscription() {
    try {
      // Check user is authenticated
      const userAuth = await this.getUserAuth();
      if (!userAuth || !userAuth.token) {
        this.showTranscriptionStatus('Please login first', 'error');
        return;
      }
      
      // Check credits balance (skip for admin users)
      await this.loadCreditsBalance();
      const creditsText = this.elements.creditsBalance.textContent;
      
      // Admin users have unlimited credits
      if (!this.currentUser.is_admin) {
        const credits = parseInt(creditsText.replace(/,/g, ''));
        if (credits <= 0) {
          this.showTranscriptionStatus('Insufficient credits. Please purchase more credits to continue.', 'error');
          return;
        }
      }
      
      this.setTranscriptionLoading(true);
      
      // Get current tab
      const tabs = await chrome.tabs.query({active: true, currentWindow: true});
      const currentTab = tabs[0];
      
      if (!currentTab || currentTab.url.startsWith('chrome://')) {
        this.showTranscriptionStatus('Please navigate to a webpage with audio/video content', 'warning');
        return;
      }
      
      // Test content script availability
      console.log('POPUP: Testing content script availability...');
      const pingResponse = await new Promise((resolve) => {
        chrome.tabs.sendMessage(currentTab.id, { type: 'PING' }, (response) => {
          if (chrome.runtime.lastError) {
            console.error('POPUP: Content script PING failed:', chrome.runtime.lastError);
            resolve(null);
          } else {
            console.log('POPUP: Content script PING successful:', response);
            resolve(response);
          }
        });
      });
      
      if (!pingResponse) {
        console.warn('POPUP: Content script not responding, injecting...');
        try {
          await chrome.scripting.executeScript({
            target: { tabId: currentTab.id },
            files: ['content.js', 'content-audio.js']
          });
          await chrome.scripting.insertCSS({
            target: { tabId: currentTab.id },
            files: ['overlay.css']
          });
          console.log('POPUP: Content scripts injected manually');
          await new Promise(resolve => setTimeout(resolve, 1000));
        } catch (injectionError) {
          console.error('POPUP: Failed to inject content scripts:', injectionError);
          throw new Error('Content scripts could not be loaded: ' + injectionError.message);
        }
      }
      
      // Get tab capture stream ID
      console.log('POPUP: Getting tab capture stream ID...');
      const streamId = await new Promise((resolve, reject) => {
        if (!chrome.tabCapture || !chrome.tabCapture.getMediaStreamId) {
          reject(new Error('Chrome Tab Capture API not available. Please update Chrome to version 116 or later.'));
          return;
        }

        chrome.tabCapture.getMediaStreamId({
          targetTabId: currentTab.id
        }, (streamId) => {
          if (chrome.runtime.lastError) {
            const errorMessage = chrome.runtime.lastError.message;
            if (errorMessage.includes('Permission dismissed')) {
              reject(new Error('Permission was dismissed. Please try again and allow tab capture.'));
            } else if (errorMessage.includes('tab is not audible')) {
              reject(new Error('This tab is not playing audio. Please navigate to a page with audio content.'));
            } else {
              reject(new Error(errorMessage));
            }
            return;
          }
          
          if (!streamId) {
            reject(new Error('No stream ID received. Please ensure the tab has audio content.'));
            return;
          }
          
          resolve(streamId);
        });
      });
      
      // Send start transcription request
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'START_TRANSCRIPTION',
          streamId: streamId,
          tabId: currentTab.id,
          userToken: userAuth.token
        }, resolve);
      });
      
      if (response && response.success) {
        this.isTranscribing = true;
        this.updateUIForTranscription(true);
        this.showTranscriptionStatus('🎤 Transcription started! Audio will be restored shortly...', 'success');
        
        setTimeout(() => {
          this.showTranscriptionStatus('📺 Live captions active! Audio should now be playing normally.', 'info');
        }, 2000);
        
        // Refresh credits balance after starting (credits will be deducted)
        setTimeout(() => this.loadCreditsBalance(), 3000);
      } else {
        const errorMsg = response?.error || 'Unknown error occurred';
        this.showTranscriptionStatus(`Failed to start: ${errorMsg}`, 'error');
      }
    } catch (error) {
      console.error('Error starting transcription:', error);
      this.showTranscriptionStatus('Error: ' + error.message, 'error');
    } finally {
      this.setTranscriptionLoading(false);
    }
  }
  
  async stopTranscription() {
    try {
      this.setStopLoading(true);
      
      const response = await new Promise((resolve) => {
        chrome.runtime.sendMessage({
          type: 'STOP_TRANSCRIPTION'
        }, resolve);
      });
      
      if (response && response.success) {
        this.isTranscribing = false;
        this.updateUIForTranscription(false);
        this.showTranscriptionStatus('Transcription stopped', 'success');
        
        // Refresh credits balance
        setTimeout(() => this.loadCreditsBalance(), 1000);
      } else {
        this.showTranscriptionStatus('Failed to stop transcription', 'error');
      }
    } catch (error) {
      console.error('Error stopping transcription:', error);
      this.showTranscriptionStatus('Error stopping transcription', 'error');
    } finally {
      this.setStopLoading(false);
    }
  }
  
  
  // API Helper Methods
  async apiCall(endpoint, method = 'GET', data = null, token = null) {
    const url = `${this.backendUrl}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };
    
    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }
    
    if (data) {
      options.body = JSON.stringify(data);
    }
    
    const response = await fetch(url, options);
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || errorData.message || `HTTP ${response.status}`);
    }
    
    return await response.json();
  }
  
  // Storage Helper Methods
  async getUserAuth() {
    const result = await chrome.storage.local.get(['userAuth']);
    return result.userAuth || null;
  }
  
  async saveUserAuth(authData) {
    await chrome.storage.local.set({ userAuth: authData });
  }
  
  async clearUserAuth() {
    await chrome.storage.local.remove(['userAuth']);
  }
  
  // UI Helper Methods
  showLogin() {
    this.elements.loginSection.classList.remove('hidden');
    this.elements.dashboardSection.classList.add('hidden');
    this.elements.startTranscription.disabled = true;
    this.updateInstructions('1. Login above to get started');
  }
  
  
  clearForms() {
    this.elements.email.value = '';
    this.elements.password.value = '';
    this.elements.signupName.value = '';
    this.elements.signupEmail.value = '';
    this.elements.signupPassword.value = '';
  }
  
  updateInstructions(step2Text) {
    const instructionElement = document.querySelector('.small-text p');
    if (instructionElement) {
      instructionElement.textContent = step2Text;
    }
  }
  
  setLoginLoading(loading) {
    this.elements.loginBtn.disabled = loading;
    this.elements.loginBtn.innerHTML = loading ? 
      '<span class="loading"></span>Logging in...' : 'Login';
  }
  
  setSignupLoading(loading) {
    this.elements.signupBtn.disabled = loading;
    this.elements.signupBtn.innerHTML = loading ? 
      '<span class="loading"></span>Creating account...' : 'Create Account';
  }
  
  setTranscriptionLoading(loading) {
    this.elements.startTranscription.disabled = loading;
    this.elements.startTranscription.innerHTML = loading ? 
      '<span class="loading"></span>Starting...' : 'Start Transcription';
  }
  
  setStopLoading(loading) {
    this.elements.stopTranscription.disabled = loading;
    this.elements.stopTranscription.innerHTML = loading ? 
      '<span class="loading"></span>Stopping...' : 'Stop Transcription';
  }
  
  updateUIForTranscription(isTranscribing) {
    if (isTranscribing) {
      this.elements.startTranscription.classList.add('hidden');
      this.elements.stopTranscription.classList.remove('hidden');
      
      // Start live credit balance updates every 30 seconds during transcription
      this.startCreditsUpdateInterval();
    } else {
      this.elements.startTranscription.classList.remove('hidden');
      this.elements.stopTranscription.classList.add('hidden');
      
      // Stop live credit balance updates when transcription ends
      this.stopCreditsUpdateInterval();
    }
  }
  
  startCreditsUpdateInterval() {
    // Clear any existing interval
    this.stopCreditsUpdateInterval();
    
    // Update credits balance every 30 seconds during transcription
    this.creditsUpdateInterval = setInterval(() => {
      console.log('💰 Refreshing credit balance during transcription...');
      this.loadCreditsBalance();
    }, 30000); // 30 seconds
    
    console.log('💰 Started live credit balance updates (every 30 seconds)');
  }
  
  stopCreditsUpdateInterval() {
    if (this.creditsUpdateInterval) {
      clearInterval(this.creditsUpdateInterval);
      this.creditsUpdateInterval = null;
      console.log('💰 Stopped live credit balance updates');
    }
  }
  
  showLoginStatus(message, type) {
    this.elements.loginStatus.textContent = message;
    this.elements.loginStatus.className = `status ${type}`;
    this.elements.loginStatus.classList.remove('hidden');
    
    setTimeout(() => {
      this.elements.loginStatus.classList.add('hidden');
    }, 5000);
  }
  
  showTranscriptionStatus(message, type) {
    this.elements.transcriptionStatus.textContent = message;
    this.elements.transcriptionStatus.className = `status ${type}`;
    this.elements.transcriptionStatus.classList.remove('hidden');
    
    setTimeout(() => {
      this.elements.transcriptionStatus.classList.add('hidden');
    }, 5000);
  }
  
  
  checkTranscriptionStatus() {
    chrome.runtime.sendMessage({
      type: 'GET_TRANSCRIPTION_STATUS'
    }, (response) => {
      if (response && response.isTranscribing) {
        this.isTranscribing = true;
        this.updateUIForTranscription(true);
        this.showTranscriptionStatus('Transcription is running', 'success');
      }
    });
  }
}

// Initialize popup when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new PopupController();
});

console.log('🎤 Live Transcription popup loaded with authentication');