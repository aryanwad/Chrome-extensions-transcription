"""
Health check and system status endpoints
"""

import json
import os
import boto3
from datetime import datetime
from typing import Dict, Any
from .auth import lambda_response

def check(event, context):
    """
    Health check endpoint for monitoring and load balancer
    """
    try:
        # Basic health check
        health_status = {
            'status': 'healthy',
            'timestamp': datetime.utcnow().isoformat(),
            'service': 'live-transcription-backend',
            'version': '1.0.0',
            'region': os.environ.get('AWS_REGION', 'us-east-1'),
            'stage': os.environ.get('STAGE', 'dev')
        }
        
        # Check DynamoDB connectivity
        try:
            dynamodb = boto3.resource('dynamodb')
            # Try to access one of our tables
            users_table = dynamodb.Table(os.environ['DYNAMODB_TABLE_USERS'])
            users_table.meta.client.describe_table(TableName=users_table.name)
            health_status['dynamodb'] = 'connected'
        except Exception as e:
            health_status['dynamodb'] = f'error: {str(e)}'
            health_status['status'] = 'degraded'
        
        # Check environment variables
        required_env_vars = [
            'ASSEMBLYAI_API_KEY',
            'OPENAI_API_KEY',
            'STRIPE_SECRET_KEY',
            'JWT_SECRET'
        ]
        
        missing_env_vars = []
        for var in required_env_vars:
            if not os.environ.get(var):
                missing_env_vars.append(var)
        
        if missing_env_vars:
            health_status['environment'] = f'missing: {", ".join(missing_env_vars)}'
            health_status['status'] = 'unhealthy'
        else:
            health_status['environment'] = 'configured'
        
        # Determine overall status code
        if health_status['status'] == 'healthy':
            status_code = 200
        elif health_status['status'] == 'degraded':
            status_code = 200  # Still return 200 for degraded
        else:
            status_code = 503  # Service unavailable
        
        return lambda_response(status_code, health_status)
        
    except Exception as e:
        error_status = {
            'status': 'unhealthy',
            'error': str(e),
            'timestamp': datetime.utcnow().isoformat()
        }
        return lambda_response(503, error_status)

def version(event, context):
    """
    Return detailed version and build information
    """
    try:
        version_info = {
            'service': 'live-transcription-backend',
            'version': '1.0.0',
            'build_date': '2025-08-15',
            'git_commit': os.environ.get('GIT_COMMIT', 'unknown'),
            'stage': os.environ.get('STAGE', 'dev'),
            'region': os.environ.get('AWS_REGION', 'us-east-1'),
            'runtime': 'python3.9',
            'framework': 'serverless',
            'dependencies': {
                'boto3': '1.34.131',
                'stripe': '5.5.0',
                'openai': '1.35.12',
                'assemblyai': '0.24.0'
            },
            'features': [
                'user_authentication',
                'credit_management',
                'secure_api_proxy',
                'stripe_payments',
                'usage_analytics',
                'real_time_transcription',
                'catchup_processing'
            ]
        }
        
        return lambda_response(200, version_info)
        
    except Exception as e:
        return lambda_response(500, {'error': str(e)})