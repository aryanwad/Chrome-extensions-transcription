"""
Credit management system for Live Transcription Backend
Handles credit balance, purchases, and usage tracking
"""

import json
import os
import boto3
import stripe
from datetime import datetime
from typing import Dict, Any
import uuid
from .auth import authenticate_request, lambda_response, convert_decimals

# DynamoDB setup
dynamodb = boto3.resource('dynamodb')
users_table = dynamodb.Table(os.environ['DYNAMODB_TABLE_USERS'])
transactions_table = dynamodb.Table(os.environ['DYNAMODB_TABLE_TRANSACTIONS'])
usage_table = dynamodb.Table(os.environ['DYNAMODB_TABLE_USAGE'])

# Stripe setup
stripe.api_key = os.environ['STRIPE_SECRET_KEY']

# Credit pricing configuration
CREDIT_PACKAGES = {
    'starter': {
        'credits': 500,
        'price': 299,  # $2.99 in cents
        'price_id': 'price_starter_package',  # Stripe Price ID
        'name': 'Starter Pack'
    },
    'popular': {
        'credits': 2000,
        'price': 999,  # $9.99 in cents
        'price_id': 'price_popular_package',
        'name': 'Popular Pack'
    },
    'power': {
        'credits': 5000,
        'price': 1999,  # $19.99 in cents
        'price_id': 'price_power_package', 
        'name': 'Power Pack'
    }
}

# Credit costs for different services
CREDIT_COSTS = {
    'live_transcription_per_minute': 10,
    'catchup_30min': 300,
    'catchup_60min': 600,
    'ask_agent_query': 5
}

def get_balance(event, context):
    """
    Get user's current credit balance
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
        
        # Convert Decimal objects to regular Python types
        user_data = convert_decimals(user_data)
        
        # Return simple balance number (what frontend expects)
        balance = user_data.get('credits_balance', 0)
        
        return lambda_response(200, {
            'balance': balance,
            'subscription_tier': user_data.get('subscription_tier', 'free'),
            'total_credits_purchased': user_data.get('total_credits_purchased', 0),
            'total_usage': user_data.get('total_usage', 0)
        })
        
    except Exception as e:
        print(f"Get balance error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})

def purchase(event, context):
    """
    Create Stripe checkout session for credit purchase
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
        
        # Parse request
        body = json.loads(event['body'])
        package_id = body.get('package_id')
        success_url = body.get('success_url', 'https://www.google.com/?payment=success&msg=Credits+added+successfully')
        cancel_url = body.get('cancel_url', 'https://www.google.com/?payment=cancelled&msg=Payment+was+cancelled')
        
        # Validate package
        if package_id not in CREDIT_PACKAGES:
            return lambda_response(400, {'error': 'Invalid package ID'})
        
        package = CREDIT_PACKAGES[package_id]
        
        # Create Stripe checkout session
        try:
            checkout_session = stripe.checkout.Session.create(
                payment_method_types=['card'],
                line_items=[{
                    'price_data': {
                        'currency': 'usd',
                        'product_data': {
                            'name': f"Live Transcription Credits - {package['name']}",
                            'description': f"{package['credits']} transcription credits"
                        },
                        'unit_amount': package['price'],
                    },
                    'quantity': 1,
                }],
                mode='payment',
                success_url=success_url,
                cancel_url=cancel_url,
                client_reference_id=user_data['user_id'],
                metadata={
                    'user_id': user_data['user_id'],
                    'package_id': package_id,
                    'credits': package['credits']
                }
            )
            
            # Record pending transaction
            transaction_id = str(uuid.uuid4())
            transaction_data = {
                'transaction_id': transaction_id,
                'user_id': user_data['user_id'],
                'stripe_session_id': checkout_session.id,
                'package_id': package_id,
                'credits': package['credits'],
                'amount': package['price'],
                'status': 'pending',
                'created_at': datetime.utcnow().isoformat()
            }
            
            transactions_table.put_item(Item=transaction_data)
            
            return lambda_response(200, {
                'checkout_url': checkout_session.url,
                'session_id': checkout_session.id,
                'transaction_id': transaction_id
            })
            
        except stripe.error.StripeError as e:
            print(f"Stripe error: {e}")
            return lambda_response(400, {'error': 'Payment processing error'})
        
    except json.JSONDecodeError:
        return lambda_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Purchase error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})

def deduct_credits(user_id: str, credits_to_deduct: int, service_type: str, metadata: Dict = None) -> bool:
    """
    Deduct credits from user balance and log usage
    Returns True if successful, False if insufficient credits
    """
    try:
        # Get current user data
        response = users_table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return False
        
        user_data = response['Item']
        current_balance = user_data.get('credits_balance', 0)
        
        # Admin users have unlimited credits - don't deduct anything
        if user_data.get('is_admin', False):
            # Log usage for admin but don't deduct credits
            log_usage(user_id, service_type, credits_to_deduct, metadata)
            return True
        
        # Check if user has enough credits
        if current_balance < credits_to_deduct:
            return False
        
        # Update user balance
        new_balance = current_balance - credits_to_deduct
        new_total_usage = user_data.get('total_usage', 0) + credits_to_deduct
        
        users_table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET credits_balance = :balance, total_usage = :usage, last_used = :timestamp',
            ExpressionAttributeValues={
                ':balance': new_balance,
                ':usage': new_total_usage,
                ':timestamp': datetime.utcnow().isoformat()
            }
        )
        
        # Log usage
        usage_record = {
            'user_id': user_id,
            'timestamp': datetime.utcnow().isoformat(),
            'service_type': service_type,
            'credits_used': credits_to_deduct,
            'balance_after': new_balance,
            'metadata': metadata or {}
        }
        
        usage_table.put_item(Item=usage_record)
        
        return True
        
    except Exception as e:
        print(f"Error deducting credits: {e}")
        return False

def add_credits(user_id: str, credits_to_add: int, transaction_id: str = None) -> bool:
    """
    Add credits to user balance (for purchases or promotions)
    """
    try:
        # Get current user data
        response = users_table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return False
        
        user_data = response['Item']
        current_balance = user_data.get('credits_balance', 0)
        current_purchased = user_data.get('total_credits_purchased', 0)
        
        # Update user balance
        new_balance = current_balance + credits_to_add
        new_purchased = current_purchased + credits_to_add
        
        users_table.update_item(
            Key={'user_id': user_id},
            UpdateExpression='SET credits_balance = :balance, total_credits_purchased = :purchased',
            ExpressionAttributeValues={
                ':balance': new_balance,
                ':purchased': new_purchased
            }
        )
        
        # If this is from a transaction, update transaction status
        if transaction_id:
            transactions_table.update_item(
                Key={'transaction_id': transaction_id},
                UpdateExpression='SET #status = :status, completed_at = :timestamp',
                ExpressionAttributeNames={'#status': 'status'},
                ExpressionAttributeValues={
                    ':status': 'completed',
                    ':timestamp': datetime.utcnow().isoformat()
                }
            )
        
        return True
        
    except Exception as e:
        print(f"Error adding credits: {e}")
        return False

def check_credits(user_id: str, required_credits: int) -> tuple[bool, int]:
    """
    Check if user has enough credits for a service
    Returns (has_enough, current_balance)
    """
    try:
        response = users_table.get_item(Key={'user_id': user_id})
        if 'Item' not in response:
            return False, 0
        
        user_data = response['Item']
        current_balance = user_data.get('credits_balance', 0)
        
        # Admin users have unlimited credits
        if user_data.get('is_admin', False):
            return True, 999999  # Always return true for admin with high balance display
        
        return current_balance >= required_credits, current_balance
        
    except Exception as e:
        print(f"Error checking credits: {e}")
        return False, 0

def get_usage_history(event, context):
    """
    Get user's usage history (last 30 days)
    """
    try:
        # Authenticate user
        user_data, error_response = authenticate_request(event)
        if error_response:
            return error_response
        
        # Get usage records for the user
        response = usage_table.query(
            KeyConditionExpression='user_id = :user_id',
            ExpressionAttributeValues={':user_id': user_data['user_id']},
            ScanIndexForward=False,  # Sort by timestamp descending
            Limit=50  # Last 50 usage records
        )
        
        usage_records = response.get('Items', [])
        
        # Calculate summary statistics
        total_credits_used = sum(record.get('credits_used', 0) for record in usage_records)
        service_breakdown = {}
        
        for record in usage_records:
            service_type = record.get('service_type', 'unknown')
            if service_type not in service_breakdown:
                service_breakdown[service_type] = 0
            service_breakdown[service_type] += record.get('credits_used', 0)
        
        return lambda_response(200, {
            'usage_history': usage_records,
            'summary': {
                'total_credits_used': total_credits_used,
                'service_breakdown': service_breakdown,
                'current_balance': user_data.get('credits_balance', 0)
            }
        })
        
    except Exception as e:
        print(f"Get usage history error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})