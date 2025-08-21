// Twitch API integration for VOD access and m3u8 URL retrieval
class TwitchAPI {
  constructor() {
    // These will be loaded from the secure backend
    this.clientId = null;
    this.clientSecret = null;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async initialize() {
    try {
      // Get Twitch API credentials from secure backend
      const response = await fetch('https://gak2qkt4df.execute-api.us-east-1.amazonaws.com/dev/twitch/credentials', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${await this.getUserToken()}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get Twitch credentials: ${response.status}`);
      }

      const data = await response.json();
      this.clientId = data.client_id;
      this.clientSecret = data.client_secret;
      
      await this.refreshAccessToken();
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  async getUserToken() {
    const result = await chrome.storage.local.get(['userAuth']);
    return result.userAuth?.token;
  }

  async refreshAccessToken() {
    try {
      // Remove debug logging
      
      const response = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'client_credentials'
        })
      });

      if (!response.ok) {
        throw new Error(`Token refresh failed: ${response.status}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = Date.now() + (data.expires_in * 1000);
      
      // Remove debug logging
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  async ensureValidToken() {
    if (!this.accessToken || Date.now() >= this.tokenExpiry - 60000) { // Refresh 1 min early
      await this.refreshAccessToken();
    }
  }

  extractChannelFromUrl(streamUrl) {
    try {
      // Handle various Twitch URL formats
      const patterns = [
        /twitch\.tv\/([^\/\?]+)/,
        /twitch\.tv\/videos\/(\d+)/,
        /twitch\.tv\/([^\/]+)\/v\/(\d+)/,
      ];

      for (const pattern of patterns) {
        const match = streamUrl.match(pattern);
        if (match) {
          return match[1];
        }
      }
      
      throw new Error('Could not extract channel from Twitch URL');
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  async getChannelId(channelName) {
    try {
      await this.ensureValidToken();
      
      const response = await fetch(`https://api.twitch.tv/helix/users?login=${channelName}`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get channel ID: ${response.status}`);
      }

      const data = await response.json();
      if (!data.data || data.data.length === 0) {
        throw new Error(`Channel '${channelName}' not found`);
      }

      return data.data[0].id;
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  async getRecentVODs(channelId, durationMinutes = 30) {
    try {
      await this.ensureValidToken();
      
      const response = await fetch(`https://api.twitch.tv/helix/videos?user_id=${channelId}&type=archive&first=1`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`
        }
      });

      if (!response.ok) {
        throw new Error(`Failed to get VODs: ${response.status}`);
      }

      const data = await response.json();
      if (!data.data || data.data.length === 0) {
        throw new Error('No recent VODs found for this channel');
      }

      // Get the most recent VOD
      const recentVOD = data.data[0];
      const vodId = recentVOD.id;
      
      console.log(`✅ Found recent VOD: ${vodId} - ${recentVOD.title}`);
      
      // Get m3u8 URL for the VOD
      return await this.getVODM3U8Url(vodId, durationMinutes);
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  async getVODM3U8Url(vodId, durationMinutes) {
    try {
      console.log(`🔄 Getting m3u8 URL for VOD: ${vodId}`);
      
      // Get GQL token for VOD access - this is the key missing piece!
      const gqlTokenData = await this.getGQLToken(vodId);
      console.log('🔑 GQL Token obtained:', { hasToken: !!gqlTokenData.token, hasSig: !!gqlTokenData.sig });
      
      // Use the GQL token with usher endpoint
      const usherUrl = `https://usher.ttvnw.net/vod/${vodId}.m3u8?allow_source=true&allow_audio_only=true&player_backend=mediaplayer&playlist_include_framerate=true&sig=${gqlTokenData.sig}&token=${gqlTokenData.token}`;
      
      console.log('📡 Requesting m3u8 with GQL token...');
      const response = await fetch(usherUrl, {
        headers: {
          'Client-ID': this.clientId,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });
      
      console.log('📨 M3U8 Response Status:', response.status, response.statusText);
      
      // Check if request was successful with GQL token
      if (!response.ok) {
        console.error(`❌ M3U8 request failed with GQL token: ${response.status} ${response.statusText}`);
        console.error('VOD ID:', vodId);
        console.error('Request URL (truncated):', usherUrl.substring(0, 100) + '...');
        
        if (response.status === 403) {
          throw new Error(`VOD access forbidden (${response.status}). The VOD may be deleted, geo-restricted, or have access restrictions.`);
        } else if (response.status === 404) {
          throw new Error(`VOD not found (${response.status}). The VOD may have been deleted.`);
        } else {
          throw new Error(`Failed to get m3u8 URL: ${response.status} - ${response.statusText}`);
        }
      }

      const m3u8Content = await response.text();
      console.log('📋 M3U8 content length:', m3u8Content.length, 'characters');
      
      // Parse the master playlist to get the lowest quality stream for audio extraction
      const lines = m3u8Content.split('\n');
      const streams = [];
      let currentStreamInfo = null;
      
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          // Parse bandwidth from stream info
          const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
          currentStreamInfo = {
            bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0,
            line: line
          };
          continue;
        }
        
        if (currentStreamInfo && line && !line.startsWith('#')) {
          // This is a stream URL
          streams.push({
            url: line,
            bandwidth: currentStreamInfo.bandwidth,
            info: currentStreamInfo.line
          });
          currentStreamInfo = null;
        }
      }
      
      // Select the stream with the lowest bandwidth for audio extraction
      console.log('🎬 Found', streams.length, 'quality options:');
      streams.forEach((stream, index) => {
        console.log(`  ${index + 1}. Bandwidth: ${stream.bandwidth}bps (${(stream.bandwidth / 1000000).toFixed(2)}Mbps)`);
      });
      
      let bestQualityUrl = null;
      if (streams.length > 0) {
        const lowestBandwidthStream = streams.reduce((lowest, current) => 
          current.bandwidth < lowest.bandwidth ? current : lowest
        );
        bestQualityUrl = lowestBandwidthStream.url;
        console.log('✅ Selected LOWEST quality:', (lowestBandwidthStream.bandwidth / 1000000).toFixed(2), 'Mbps for audio extraction');
      }

      if (!bestQualityUrl) {
        throw new Error('Could not find stream URL in m3u8 playlist');
      }
      
      return {
        vodId: vodId,
        m3u8Url: bestQualityUrl,
        durationMinutes: durationMinutes
      };
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  async getCatchupM3U8(streamUrl, durationMinutes) {
    try {
      console.log(`🎯 Getting catch-up m3u8 for: ${streamUrl} (${durationMinutes}min)`);
      
      // Initialize if needed
      if (!this.accessToken) {
        await this.initialize();
      }

      // Extract channel name from URL
      const channelName = this.extractChannelFromUrl(streamUrl);
      console.log(`📺 Channel: ${channelName}`);

      // Get channel ID
      const channelId = await this.getChannelId(channelName);
      console.log(`🔢 Channel ID: ${channelId}`);

      // Try to get recent VOD m3u8 URL first
      try {
        const vodInfo = await this.getRecentVODs(channelId, durationMinutes);
        return vodInfo;
      } catch (vodError) {
        console.warn('❌ VOD access failed, trying live stream as fallback:', vodError.message);
        
        // Fallback: try to get live stream m3u8 if VODs are not accessible
        try {
          return await this.getLiveStreamM3U8(channelName, durationMinutes);
        } catch (liveError) {
          throw new Error(`Both VOD and live stream access failed. VOD error: ${vodError.message}. Live error: ${liveError.message}`);
        }
      }
    } catch (error) {
      // Remove debug logging
      throw error;
    }
  }

  async getGQLToken(vodId) {
    try {
      console.log('🔐 Getting GQL token for VOD access...');
      
      await this.ensureValidToken();
      
      // Twitch GraphQL query to get VOD access token
      const gqlQuery = {
        "operationName": "PlaybackAccessToken_Template",
        "query": "query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isLive) {    value    signature   __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: \"web\", playerBackend: \"mediaplayer\", playerType: $playerType}) @include(if: $isVod) {    value    signature    __typename  }}",
        "variables": {
          "isLive": false,
          "isVod": true,
          "login": "",
          "vodID": vodId,
          "playerType": "site"
        }
      };

      // Use Twitch's public/default Client-ID for GQL endpoint (required for gql.twitch.tv)
      const gqlClientId = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
      
      // Log the full request for debugging
      console.log('📤 GQL Request Details:');
      console.log('URL:', 'https://gql.twitch.tv/gql');
      console.log('Using GQL Client-ID:', gqlClientId);
      console.log('Regular Client-ID:', this.clientId);
      console.log('Headers:', {
        'Client-ID': gqlClientId,
        'Content-Type': 'application/json',
        'Authorization': this.accessToken ? 'Bearer [PRESENT]' : 'MISSING',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      });
      console.log('Request Body:', JSON.stringify(gqlQuery, null, 2));
      
      const response = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: {
          'Client-ID': gqlClientId,
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        },
        body: JSON.stringify(gqlQuery)
      });

      console.log('📨 GQL Response Status:', response.status, response.statusText);
      
      if (!response.ok) {
        // Try to get error details from response
        const errorText = await response.text();
        console.error('❌ GQL Response Error:', errorText);
        throw new Error(`GQL token request failed: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log('📦 GQL Response Data:', JSON.stringify(data, null, 2));
      
      if (!data.data || !data.data.videoPlaybackAccessToken) {
        console.error('❌ Missing playback access token in response:', data);
        throw new Error('No playback access token in GQL response');
      }

      const tokenData = data.data.videoPlaybackAccessToken;
      console.log('🔑 Token Data Retrieved:', { hasValue: !!tokenData.value, hasSignature: !!tokenData.signature });
      
      return {
        token: tokenData.value,
        sig: tokenData.signature
      };
      
    } catch (error) {
      console.error('❌ GQL token request failed:', error);
      throw error;
    }
  }

  async getLiveStreamM3U8(channelName, durationMinutes) {
    try {
      console.log(`🔴 Trying to get live stream m3u8 for: ${channelName}`);
      
      await this.ensureValidToken();
      
      // Try to get live stream m3u8
      const response = await fetch(`https://usher.ttvnw.net/api/channel/hls/${channelName}.m3u8?allow_source=true&allow_audio_only=true&allow_spectre=false&player=twitchweb&playlist_include_framerate=true&segment_preference=4&sig=&token=`, {
        headers: {
          'Client-ID': this.clientId,
          'Authorization': `Bearer ${this.accessToken}`,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      });

      if (!response.ok) {
        // Try without authentication for public streams
        const fallbackResponse = await fetch(`https://usher.ttvnw.net/api/channel/hls/${channelName}.m3u8?allow_source=true&allow_audio_only=true`);
        
        if (!fallbackResponse.ok) {
          throw new Error(`Live stream not available: ${response.status} (${channelName} may be offline or have restricted streams)`);
        }
        
        const m3u8Content = await fallbackResponse.text();
        return this.parseLiveStreamM3U8(m3u8Content, channelName, durationMinutes);
      }

      const m3u8Content = await response.text();
      return this.parseLiveStreamM3U8(m3u8Content, channelName, durationMinutes);
      
    } catch (error) {
      console.error('❌ Live stream m3u8 failed:', error);
      throw error;
    }
  }

  parseLiveStreamM3U8(m3u8Content, channelName, durationMinutes) {
    // Parse live stream m3u8 similar to VOD parsing
    const lines = m3u8Content.split('\n');
    const streams = [];
    let currentStreamInfo = null;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      
      if (line.startsWith('#EXT-X-STREAM-INF:')) {
        const bandwidthMatch = line.match(/BANDWIDTH=(\d+)/);
        currentStreamInfo = {
          bandwidth: bandwidthMatch ? parseInt(bandwidthMatch[1]) : 0,
          line: line
        };
        continue;
      }
      
      if (currentStreamInfo && line && !line.startsWith('#')) {
        streams.push({
          url: line,
          bandwidth: currentStreamInfo.bandwidth,
          info: currentStreamInfo.line
        });
        currentStreamInfo = null;
      }
    }
    
    if (streams.length === 0) {
      throw new Error('No streams found in live m3u8 playlist');
    }
    
    // Select lowest bandwidth stream for audio extraction
    const lowestBandwidthStream = streams.reduce((lowest, current) => 
      current.bandwidth < lowest.bandwidth ? current : lowest
    );
    
    console.log(`✅ Found live stream URL for ${channelName} (${lowestBandwidthStream.bandwidth} bandwidth)`);
    
    return {
      vodId: `live-${channelName}`,
      m3u8Url: lowestBandwidthStream.url,
      durationMinutes: durationMinutes,
      isLive: true
    };
  }
}

// Export for use in background script
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TwitchAPI;
} else if (typeof window !== 'undefined') {
  window.TwitchAPI = TwitchAPI;
} else {
  // Service worker context - attach to global scope
  self.TwitchAPI = TwitchAPI;
}