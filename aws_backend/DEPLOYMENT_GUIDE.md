# AWS Lambda Backend Deployment Guide

Complete guide to deploy the secure backend service for Live Transcription Chrome Extension.

## 🚀 Quick Start

```bash
# 1. Install dependencies
cd aws_backend
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your API keys

# 3. Deploy to AWS
./deploy.sh dev
```

## 📋 Prerequisites

### Required Software
- **Node.js 16+** and npm
- **AWS CLI** configured with credentials
- **Python 3.9+** (for Lambda runtime)
- **Serverless Framework** (auto-installed by script)

### Required Accounts & API Keys
1. **AWS Account** with Lambda and DynamoDB permissions
2. **AssemblyAI API Key** from [assemblyai.com](https://www.assemblyai.com)
3. **OpenAI API Key** from [platform.openai.com](https://platform.openai.com)
4. **Stripe Account** for payment processing
5. **Twitch API Credentials** for catch-up functionality

## 🔧 Configuration

### 1. Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# API Keys (KEEP THESE SECRET!)
ASSEMBLYAI_API_KEY=your_assemblyai_key_here
OPENAI_API_KEY=your_openai_key_here

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_your_stripe_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here

# JWT Secret (generate a secure random string)
JWT_SECRET=your_very_secure_random_jwt_secret_here

# Twitch API
TWITCH_CLIENT_ID=your_twitch_client_id_here
TWITCH_CLIENT_SECRET=your_twitch_client_secret_here
```

### 2. AWS Credentials

Configure AWS CLI with appropriate permissions:

```bash
aws configure
```

Required IAM permissions:
- Lambda (create, update, invoke functions)
- DynamoDB (create tables, read/write data)
- API Gateway (create APIs, manage routes)
- CloudFormation (deploy stacks)
- IAM (create roles for Lambda execution)

## 🏗️ Deployment

### Development Deployment
```bash
./deploy.sh dev
```

### Production Deployment
```bash
./deploy.sh prod
```

### Manual Deployment
```bash
serverless deploy --stage prod
```

## 📊 Post-Deployment Setup

### 1. Configure Stripe Webhooks

After deployment, configure these Stripe webhook endpoints:

- **URL**: `https://your-api-gateway-url/webhooks/stripe`
- **Events**: 
  - `checkout.session.completed`
  - `checkout.session.expired`
  - `invoice.payment_failed`

### 2. Update Chrome Extension

Update your Chrome extension to use the new backend:

```javascript
// In chrome_extension/background.js
const BACKEND_API_URL = 'https://your-api-gateway-url';
```

### 3. Test Health Endpoint

Verify deployment:
```bash
curl https://your-api-gateway-url/health
```

Expected response:
```json
{
  "status": "healthy",
  "dynamodb": "connected",
  "environment": "configured"
}
```

## 🗄️ Database Schema

The deployment automatically creates these DynamoDB tables:

### Users Table
```
Primary Key: user_id (String)
Global Secondary Index: email
Attributes:
- user_id, email, name, password_hash
- credits_balance, subscription_tier
- created_at, last_login, is_active
- total_credits_purchased, total_usage
```

### Usage Table
```
Primary Key: user_id (String), timestamp (String)
Attributes:
- user_id, timestamp, service_type
- credits_used, balance_after, metadata
```

### Transactions Table
```
Primary Key: transaction_id (String)
Global Secondary Index: user_id
Attributes:
- transaction_id, user_id, stripe_session_id
- package_id, credits, amount, status
- created_at, completed_at
```

## 🔍 Monitoring & Debugging

### View Logs
```bash
# View logs for specific function
serverless logs -f register --stage prod

# Tail logs in real-time
serverless logs -f register --stage prod --tail
```

### Check Function Status
```bash
serverless info --stage prod
```

### Local Testing
```bash
# Install serverless-offline for local testing
npm install -g serverless-offline
serverless offline
```

## 💰 Cost Optimization

### Lambda Configuration
- **Memory**: 512MB (optimized for transcription processing)
- **Timeout**: 30s (stream), 300s (catch-up)
- **Runtime**: Python 3.9

### DynamoDB Configuration
- **Billing Mode**: Pay-per-request (cost-effective for variable traffic)
- **Backup**: Point-in-time recovery enabled

### Estimated Monthly Costs (1000 active users)
- **Lambda**: $20-40
- **DynamoDB**: $15-25  
- **API Gateway**: $10-15
- **CloudWatch Logs**: $5-10
- **Total**: ~$50-90/month

## 🛡️ Security Features

### API Security
- JWT token authentication for all protected endpoints
- CORS configured for Chrome extension origins only
- Request validation and sanitization
- Rate limiting (configurable)

### Data Security
- API keys stored as encrypted environment variables
- Password hashing with bcrypt
- Secure session management
- No sensitive data in logs

### Network Security
- HTTPS only (enforced by API Gateway)
- VPC deployment option available
- AWS security groups and NACLs

## 🚨 Troubleshooting

### Common Issues

**Deployment fails with permissions error:**
```bash
# Check AWS credentials
aws sts get-caller-identity

# Verify IAM permissions
aws iam list-attached-role-policies --role-name your-role-name
```

**Environment variables not found:**
```bash
# Verify .env file exists and is properly formatted
cat .env

# Check serverless.yml environment section
```

**DynamoDB access denied:**
```bash
# Check IAM role has DynamoDB permissions
# Verify table names in serverless.yml match environment variables
```

**Stripe webhook not working:**
- Verify webhook URL is correct
- Check Stripe webhook secret matches environment variable
- Ensure webhook events are configured correctly

### Debug Mode

Enable verbose logging:
```bash
serverless deploy --stage dev --verbose
```

## 📈 Scaling Considerations

### Auto Scaling
- Lambda: Automatic scaling up to 1000 concurrent executions
- DynamoDB: On-demand scaling with burst capacity
- API Gateway: Handles 10,000 requests per second by default

### Performance Optimization
- Lambda warm-up strategies for reduced cold starts
- DynamoDB query optimization with proper indexes
- API Gateway caching for frequently accessed data

### High Availability
- Multi-AZ deployment (automatic with AWS Lambda)
- DynamoDB global tables for multi-region
- CloudFront distribution for global API access

## 🔄 CI/CD Integration

### GitHub Actions Example
```yaml
name: Deploy to AWS
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - name: Deploy to AWS
        run: |
          cd aws_backend
          npm install
          serverless deploy --stage prod
```

## 📞 Support

For deployment issues:
1. Check CloudFormation console for stack events
2. Review Lambda function logs in CloudWatch
3. Verify DynamoDB table creation and permissions
4. Test individual endpoints with curl or Postman

## 🔧 Advanced Configuration

### Custom Domain
```yaml
# Add to serverless.yml
custom:
  customDomain:
    domainName: api.yourdomain.com
    stage: prod
    createRoute53Record: true
```

### VPC Deployment
```yaml
# Add to serverless.yml provider section
vpc:
  securityGroupIds:
    - sg-xxxxxxxxx
  subnetIds:
    - subnet-xxxxxxxxx
    - subnet-yyyyyyyyy
```

This comprehensive backend service provides enterprise-grade security, scalability, and monitoring for your Chrome extension monetization strategy! 🎉