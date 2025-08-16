#!/bin/bash

# AWS Lambda Backend Deployment Script
# This script deploys the Live Transcription backend to AWS

set -e  # Exit on any error

echo "🚀 Deploying Live Transcription Backend to AWS Lambda..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo "❌ Error: .env file not found!"
    echo "Please copy .env.example to .env and configure your API keys"
    exit 1
fi

# Check if serverless is installed
if ! command -v serverless &> /dev/null; then
    echo "❌ Serverless Framework not found!"
    echo "Installing Serverless Framework..."
    npm install -g serverless
fi

# Check if npm dependencies are installed
if [ ! -d node_modules ]; then
    echo "📦 Installing npm dependencies..."
    npm install
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured!"
    echo "Please run: aws configure"
    exit 1
fi

# Get deployment stage (default to dev)
STAGE=${1:-dev}
echo "📍 Deploying to stage: $STAGE"

# Deploy to AWS
echo "🔧 Deploying serverless functions..."
serverless deploy --stage $STAGE

# Get the API Gateway URL
API_URL=$(serverless info --stage $STAGE | grep "endpoints:" -A 20 | grep "https://" | head -1 | awk '{print $2}')

if [ -n "$API_URL" ]; then
    echo ""
    echo "✅ Deployment successful!"
    echo "🌐 API Gateway URL: $API_URL"
    echo ""
    echo "📋 Next steps:"
    echo "1. Update your Chrome extension to use this API URL"
    echo "2. Configure Stripe webhook endpoints:"
    echo "   - ${API_URL}/webhooks/stripe"
    echo "3. Test the health endpoint: ${API_URL}/health"
    echo ""
    echo "🔧 Available endpoints:"
    echo "   POST ${API_URL}/auth/register"
    echo "   POST ${API_URL}/auth/login"
    echo "   GET  ${API_URL}/auth/user"
    echo "   POST ${API_URL}/transcription/stream"
    echo "   POST ${API_URL}/transcription/catchup"
    echo "   GET  ${API_URL}/credits/balance"
    echo "   POST ${API_URL}/credits/purchase"
    echo "   POST ${API_URL}/webhooks/stripe"
    echo "   GET  ${API_URL}/analytics/usage"
    echo "   GET  ${API_URL}/health"
else
    echo "❌ Deployment may have failed - could not extract API URL"
    echo "Run 'serverless info --stage $STAGE' to check deployment status"
fi

echo ""
echo "💡 To remove the deployment: ./deploy.sh remove"
echo "📊 To view logs: serverless logs -f functionName --stage $STAGE"