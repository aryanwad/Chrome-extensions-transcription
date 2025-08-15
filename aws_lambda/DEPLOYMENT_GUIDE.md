# AWS Lambda Deployment Guide
## Restore Your Original Serverless Catch-up Flow

### 🎯 **Objective**
Deploy the same catch-up logic to AWS Lambda to bypass Vercel's IP blocking and restore the original user flow:
1. User on live Twitch stream
2. Clicks "⚡ Catch Up" button  
3. Automatic VOD detection and download
4. AI summary - all seamless!

### 📦 **What's Ready**
- ✅ `lambda-catchup.zip` (15MB) - Complete deployment package
- ✅ Same exact logic as Vercel version
- ✅ All dependencies included (yt-dlp, requests)
- ✅ API credentials pre-configured

### 🚀 **Deployment Steps**

#### 1. Create Lambda Function
1. Go to [AWS Lambda Console](https://console.aws.amazon.com/lambda/)
2. Click **"Create function"**
3. Choose **"Author from scratch"**
4. Function name: `live-transcription-catchup`
5. Runtime: **Python 3.11**
6. Architecture: **x86_64**
7. Click **"Create function"**

#### 2. Upload Code Package
1. In your new function, go to **"Code"** tab
2. Click **"Upload from"** → **".zip file"**
3. Upload `lambda-catchup.zip`
4. Wait for upload to complete

#### 3. Configure Function Settings
1. Go to **"Configuration"** → **"General configuration"**
2. Click **"Edit"**
3. Set **Timeout: 15 minutes (900 seconds)**
4. Set **Memory: 1024 MB** (or higher)
5. Click **"Save"**

#### 4. Add API Gateway Trigger
1. Go to **"Function overview"**
2. Click **"Add trigger"**
3. Select **"API Gateway"**
4. Choose **"Create an API"**
5. API type: **HTTP API**
6. Security: **Open** (for Chrome extension access)
7. Click **"Add"**

#### 5. Get Your Lambda URL
1. After trigger is created, you'll see an **"API endpoint"**
2. It will look like: `https://abc123.execute-api.us-east-1.amazonaws.com/default/live-transcription-catchup`
3. **Copy this URL** - you'll need it for the extension

### 🔧 **Update Chrome Extension**

Edit `/chrome_extension/background.js` line 18:
```javascript
// Replace this line:
this.backendUrl = 'https://live-transcription-catchup-g3kv6n6pk-aryan-wadhwas-projects.vercel.app'

// With your new Lambda URL:
this.backendUrl = 'https://YOUR-LAMBDA-URL-HERE.execute-api.us-east-1.amazonaws.com/default/live-transcription-catchup'
```

### 🧪 **Test Your Deployment**

#### Test 1: Health Check
```bash
curl https://YOUR-LAMBDA-URL-HERE.execute-api.us-east-1.amazonaws.com/default/live-transcription-catchup \
  -H "Content-Type: application/json" \
  -d '{"test": "health"}'
```

#### Test 2: Full Catch-up
```bash
curl -X POST https://YOUR-LAMBDA-URL-HERE.execute-api.us-east-1.amazonaws.com/default/live-transcription-catchup \
  -H "Content-Type: application/json" \
  -d '{
    "stream_url": "https://www.twitch.tv/jynxzi",
    "duration_minutes": 30,
    "user_id": "test"
  }'
```

### 🎯 **Expected Results**

**✅ If AWS Lambda works:**
- VOD detection: ✅ Works (same as before)
- Audio download: ✅ **Now works** (different IP pool)
- Transcription: ✅ Works (AssemblyAI)  
- AI Summary: ✅ Works (OpenAI GPT-4)
- **Result**: Original serverless flow restored! 🎉

**❌ If still blocked:**
- You'll get the same fallback with deep links
- But we've ruled out AWS Lambda as a solution
- Next step would be hybrid approach or different provider

### 💡 **Why This Should Work**

1. **IP Pool**: AWS Lambda has millions of rotating IPs vs Vercel's limited pool
2. **Infrastructure**: Different cloud provider, different IP reputation  
3. **Success Rate**: Much higher chance of bypassing Twitch's blocking
4. **No Code Changes**: Exact same logic, just different hosting

### 🔍 **Troubleshooting**

**Cold Start Issues:**
- First request might be slower (30s+)
- Subsequent requests will be faster
- This is normal for serverless functions

**Timeout Errors:**
- Increase memory to 1536MB or 2048MB
- 15-minute timeout should be sufficient
- Monitor CloudWatch logs for details

**403 Errors:**
- If AWS Lambda IPs are also blocked, we'll know immediately
- Check CloudWatch logs for yt-dlp error details
- Consider hybrid approach as backup

### 📊 **Cost Estimate**
- **Compute**: ~$0.10-0.30 per catch-up (depending on duration)
- **Data transfer**: ~$0.05 per catch-up  
- **API Gateway**: ~$0.01 per request
- **Total**: ~$0.15-0.35 per catch-up (still profitable at $1.99)

### 🎉 **Success Metrics**
Once deployed, you should see:
- VOD detection working instantly ✅
- Audio download succeeding (not failing with 403) ✅
- Complete transcripts instead of "extraction failed" ✅
- Rich AI summaries with actual content ✅
- **Your original vision fully restored!** 🚀

---

**Ready to deploy?** The package is built and waiting. This should restore your seamless catch-up experience!