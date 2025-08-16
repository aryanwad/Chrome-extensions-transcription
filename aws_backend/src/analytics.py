"""
Analytics module for usage tracking and monitoring
"""

import json
import os
import boto3
from datetime import datetime, timedelta
from typing import Dict, Any
from .auth import authenticate_request, lambda_response

# DynamoDB setup
dynamodb = boto3.resource('dynamodb')
usage_table = dynamodb.Table(os.environ['DYNAMODB_TABLE_USAGE'])
users_table = dynamodb.Table(os.environ['DYNAMODB_TABLE_USERS'])

def get_usage(event, context):
    """
    Get user usage analytics for the past 30 days
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
        
        # Query parameters
        query_params = event.get('queryStringParameters') or {}
        days = int(query_params.get('days', 30))
        
        # Calculate date range
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(days=days)
        
        # Get usage records for the time period
        response = usage_table.query(
            KeyConditionExpression='user_id = :user_id AND #timestamp BETWEEN :start_date AND :end_date',
            ExpressionAttributeNames={'#timestamp': 'timestamp'},
            ExpressionAttributeValues={
                ':user_id': user_data['user_id'],
                ':start_date': start_date.isoformat(),
                ':end_date': end_date.isoformat()
            },
            ScanIndexForward=False  # Sort by timestamp descending
        )
        
        usage_records = response.get('Items', [])
        
        # Calculate analytics
        analytics = calculate_usage_analytics(usage_records, days)
        
        return lambda_response(200, {
            'analytics': analytics,
            'usage_records': usage_records[:20],  # Last 20 records
            'user_summary': {
                'current_balance': user_data.get('credits_balance', 0),
                'total_usage': user_data.get('total_usage', 0),
                'subscription_tier': user_data.get('subscription_tier', 'free'),
                'member_since': user_data.get('created_at')
            }
        })
        
    except Exception as e:
        print(f"Get usage analytics error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})

def calculate_usage_analytics(usage_records: list, days: int) -> Dict:
    """
    Calculate detailed usage analytics from records
    """
    analytics = {
        'total_credits_used': 0,
        'total_sessions': len(usage_records),
        'service_breakdown': {},
        'daily_usage': {},
        'average_per_day': 0,
        'most_used_service': '',
        'peak_usage_day': '',
        'cost_estimate': 0
    }
    
    if not usage_records:
        return analytics
    
    # Process each record
    daily_totals = {}
    service_totals = {}
    
    for record in usage_records:
        credits_used = record.get('credits_used', 0)
        service_type = record.get('service_type', 'unknown')
        timestamp = record.get('timestamp', '')
        
        # Update totals
        analytics['total_credits_used'] += credits_used
        
        # Service breakdown
        if service_type not in service_totals:
            service_totals[service_type] = 0
        service_totals[service_type] += credits_used
        
        # Daily breakdown
        if timestamp:
            date_key = timestamp.split('T')[0]  # Extract date part
            if date_key not in daily_totals:
                daily_totals[date_key] = 0
            daily_totals[date_key] += credits_used
    
    # Finalize analytics
    analytics['service_breakdown'] = service_totals
    analytics['daily_usage'] = daily_totals
    analytics['average_per_day'] = analytics['total_credits_used'] / max(days, 1)
    
    # Find most used service
    if service_totals:
        analytics['most_used_service'] = max(service_totals, key=service_totals.get)
    
    # Find peak usage day
    if daily_totals:
        analytics['peak_usage_day'] = max(daily_totals, key=daily_totals.get)
    
    # Estimate cost (rough calculation)
    # Assuming average API cost of $0.05 per 10 credits
    analytics['cost_estimate'] = (analytics['total_credits_used'] / 10) * 0.05
    
    return analytics

def get_system_metrics(event, context):
    """
    Get system-wide metrics (admin only)
    This would require admin authentication
    """
    try:
        # For now, return basic health metrics
        # In production, you'd want proper admin authentication
        
        # Scan usage table for recent activity (last 24 hours)
        end_time = datetime.utcnow()
        start_time = end_time - timedelta(hours=24)
        
        # This is a simplified version - you'd want more efficient queries
        response = usage_table.scan(
            FilterExpression='#timestamp BETWEEN :start_time AND :end_time',
            ExpressionAttributeNames={'#timestamp': 'timestamp'},
            ExpressionAttributeValues={
                ':start_time': start_time.isoformat(),
                ':end_time': end_time.isoformat()
            }
        )
        
        recent_usage = response.get('Items', [])
        
        # Calculate system metrics
        system_metrics = {
            'active_users_24h': len(set(record.get('user_id') for record in recent_usage)),
            'total_requests_24h': len(recent_usage),
            'total_credits_used_24h': sum(record.get('credits_used', 0) for record in recent_usage),
            'service_distribution': {},
            'timestamp': datetime.utcnow().isoformat()
        }
        
        # Service distribution
        for record in recent_usage:
            service = record.get('service_type', 'unknown')
            if service not in system_metrics['service_distribution']:
                system_metrics['service_distribution'][service] = 0
            system_metrics['service_distribution'][service] += 1
        
        return lambda_response(200, {'system_metrics': system_metrics})
        
    except Exception as e:
        print(f"System metrics error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})