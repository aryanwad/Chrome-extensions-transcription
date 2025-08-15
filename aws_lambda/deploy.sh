#!/bin/bash
# AWS Lambda Deployment Script

echo "🚀 Deploying Live Transcription Catch-up to AWS Lambda"
echo "This should bypass Vercel's IP blocking issues"
echo "=================================================="

# Create deployment package
echo "📦 Creating deployment package..."
rm -rf deployment/
mkdir deployment/
cp lambda_function.py deployment/
cp requirements.txt deployment/

cd deployment/

# Install dependencies
echo "📥 Installing dependencies..."
pip install -r requirements.txt -t .

# Create ZIP package
echo "🗜️ Creating ZIP package..."
zip -r ../lambda-catchup.zip .

cd ..

echo "✅ Deployment package created: lambda-catchup.zip"
echo ""
echo "📋 Next steps:"
echo "1. Go to AWS Lambda console"
echo "2. Create new function: 'live-transcription-catchup'"
echo "3. Upload lambda-catchup.zip"
echo "4. Set timeout to 15 minutes (900 seconds)"
echo "5. Set memory to 1024MB or higher"
echo "6. Add API Gateway trigger"
echo "7. Test with Twitch live stream!"
echo ""
echo "💡 Expected result:"
echo "• Different IP pool should bypass Twitch blocking"
echo "• Same exact logic as Vercel version"
echo "• Much higher chance of success!"

# Show file size
ls -lh lambda-catchup.zip