# AWS Lambda Backend Service for Live Transcription

Production-ready AWS Lambda backend with API Gateway, DynamoDB, and Cognito for secure user authentication and credit management.

## Architecture

```
Chrome Extension → API Gateway → Lambda Functions → DynamoDB
                                    ↓
                              AssemblyAI/OpenAI APIs
                                    ↓
                              Stripe Webhooks
```

## Features

- 🔐 **Secure API Key Management** - Your keys never exposed to users
- 👤 **User Authentication** - AWS Cognito + JWT tokens
- 💳 **Credit System** - Track usage and payments
- 📊 **Usage Analytics** - Monitor costs and user behavior
- 🔄 **API Proxying** - Secure proxy to AssemblyAI/OpenAI
- 💰 **Payment Integration** - Stripe webhooks for credit purchases

## Deployment

1. **Prerequisites**:
   ```bash
   npm install -g aws-cli serverless
   aws configure
   ```

2. **Deploy**:
   ```bash
   cd aws_backend
   serverless deploy
   ```

3. **Configure Environment**:
   - Update `serverless.yml` with your API keys
   - Set up Stripe webhook endpoints
   - Configure CORS for your Chrome extension

## API Endpoints

### Authentication
- `POST /auth/register` - User registration with 200 free credits
- `POST /auth/login` - User login with JWT token
- `GET /auth/user` - Get user profile and credit balance

### Transcription Services
- `POST /transcription/stream` - Real-time transcription proxy
- `POST /transcription/catchup` - Catch-up processing proxy
- `GET /transcription/history` - User's transcription history

### Credit Management
- `GET /credits/balance` - Current credit balance
- `POST /credits/purchase` - Initiate credit purchase
- `POST /webhooks/stripe` - Stripe payment webhooks

### Analytics
- `GET /analytics/usage` - User usage statistics
- `GET /analytics/costs` - Cost tracking (admin only)

## Security Features

- API keys stored as encrypted environment variables
- JWT token authentication for all requests
- Rate limiting to prevent abuse
- CORS configured for Chrome extension only
- Request validation and sanitization
- Comprehensive logging for monitoring

## Cost Optimization

- Lambda cold start optimization
- DynamoDB on-demand pricing
- CloudWatch logs with retention policies
- API Gateway caching for frequently accessed data