"""
Authentication module for Live Transcription Backend
Handles user registration, login, and JWT token management
"""

import json
import os
import boto3
import hashlib
import secrets
import jwt
from datetime import datetime, timedelta
from typing import Dict, Any, Optional
import uuid
from decimal import Decimal

# DynamoDB setup
dynamodb = boto3.resource('dynamodb')
users_table = dynamodb.Table(os.environ['DYNAMODB_TABLE_USERS'])

# JWT configuration
JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALGORITHM = 'HS256'
JWT_EXPIRATION_HOURS = 24 * 7  # 7 days

def convert_decimals(obj):
    """Convert DynamoDB Decimal objects to regular Python types"""
    if isinstance(obj, dict):
        return {k: convert_decimals(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_decimals(v) for v in obj]
    elif isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    else:
        return obj

def lambda_response(status_code: int, body: Dict[Any, Any], headers: Dict[str, str] = None) -> Dict:
    """Create standardized Lambda response"""
    default_headers = {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    }
    
    if headers:
        default_headers.update(headers)
    
    return {
        'statusCode': status_code,
        'headers': default_headers,
        'body': json.dumps(body)
    }

def hash_password(password: str) -> str:
    """Hash password using SHA256 with salt"""
    salt = secrets.token_hex(16)
    hash_obj = hashlib.sha256((password + salt).encode('utf-8'))
    return f"{salt}${hash_obj.hexdigest()}"

def verify_password(password: str, hashed: str) -> bool:
    """Verify password against hash"""
    try:
        salt, stored_hash = hashed.split('$')
        hash_obj = hashlib.sha256((password + salt).encode('utf-8'))
        return hash_obj.hexdigest() == stored_hash
    except ValueError:
        return False

def generate_jwt_token(user_data: Dict) -> str:
    """Generate JWT token for authenticated user"""
    payload = {
        'user_id': user_data['user_id'],
        'email': user_data['email'],
        'exp': datetime.utcnow() + timedelta(hours=JWT_EXPIRATION_HOURS),
        'iat': datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

def verify_jwt_token(token: str) -> Optional[Dict]:
    """Verify JWT token and return user data"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        return None
    except jwt.InvalidTokenError:
        return None

def get_user_from_token(event: Dict) -> Optional[Dict]:
    """Extract and verify user from Authorization header"""
    headers = event.get('headers', {})
    auth_header = headers.get('Authorization') or headers.get('authorization')
    
    if not auth_header or not auth_header.startswith('Bearer '):
        return None
    
    token = auth_header.replace('Bearer ', '')
    return verify_jwt_token(token)

def register(event, context):
    """
    Register new user with email and password
    Grants 200 free credits on signup
    """
    try:
        # Parse request body
        body = json.loads(event['body'])
        email = body.get('email', '').lower().strip()
        password = body.get('password', '')
        name = body.get('name', '').strip()
        
        # Validation
        if not email or not password:
            return lambda_response(400, {'error': 'Email and password are required'})
        
        if len(password) < 8:
            return lambda_response(400, {'error': 'Password must be at least 8 characters'})
        
        if '@' not in email:
            return lambda_response(400, {'error': 'Invalid email format'})
        
        # Check if user already exists
        try:
            response = users_table.query(
                IndexName='EmailIndex',
                KeyConditionExpression='email = :email',
                ExpressionAttributeValues={':email': email}
            )
            
            if response['Items']:
                return lambda_response(400, {'error': 'User already exists with this email'})
                
        except Exception as e:
            print(f"Error checking existing user: {e}")
            return lambda_response(500, {'error': 'Database error'})
        
        # Create new user
        user_id = str(uuid.uuid4())
        hashed_password = hash_password(password)
        
        user_data = {
            'user_id': user_id,
            'email': email,
            'name': name,
            'password_hash': hashed_password,
            'credits_balance': 200,  # Free signup credits
            'created_at': datetime.utcnow().isoformat(),
            'subscription_tier': 'free',
            'is_active': True,
            'total_credits_purchased': 0,
            'total_usage': 0
        }
        
        # Save to DynamoDB
        users_table.put_item(Item=user_data)
        
        # Generate JWT token
        token = generate_jwt_token(user_data)
        
        # Return success response (exclude sensitive data)
        response_data = {
            'user_id': user_id,
            'email': email,
            'name': name,
            'credits_balance': 200,
            'subscription_tier': 'free',
            'token': token
        }
        
        return lambda_response(201, {
            'message': 'User registered successfully',
            'user': response_data
        })
        
    except json.JSONDecodeError:
        return lambda_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Registration error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})

def login(event, context):
    """
    Authenticate user with email and password
    Returns JWT token on success
    """
    try:
        # Parse request body
        body = json.loads(event['body'])
        email = body.get('email', '').lower().strip()
        password = body.get('password', '')
        
        # Validation
        if not email or not password:
            return lambda_response(400, {'error': 'Email and password are required'})
        
        # Find user by email
        try:
            response = users_table.query(
                IndexName='EmailIndex',
                KeyConditionExpression='email = :email',
                ExpressionAttributeValues={':email': email}
            )
            
            if not response['Items']:
                return lambda_response(401, {'error': 'Invalid email or password'})
            
            user_data = convert_decimals(response['Items'][0])
            
        except Exception as e:
            print(f"Error finding user: {e}")
            return lambda_response(500, {'error': 'Database error'})
        
        # Verify password
        if not verify_password(password, user_data['password_hash']):
            return lambda_response(401, {'error': 'Invalid email or password'})
        
        # Check if user is active
        if not user_data.get('is_active', True):
            return lambda_response(401, {'error': 'Account is deactivated'})
        
        # Generate JWT token
        token = generate_jwt_token(user_data)
        
        # Update last login
        users_table.update_item(
            Key={'user_id': user_data['user_id']},
            UpdateExpression='SET last_login = :timestamp',
            ExpressionAttributeValues={':timestamp': datetime.utcnow().isoformat()}
        )
        
        # Return success response (exclude sensitive data)
        response_data = {
            'user_id': user_data['user_id'],
            'email': user_data['email'],
            'name': user_data.get('name', ''),
            'credits_balance': user_data.get('credits_balance', 0),
            'subscription_tier': user_data.get('subscription_tier', 'free'),
            'token': token
        }
        
        return lambda_response(200, {
            'message': 'Login successful',
            'user': response_data
        })
        
    except json.JSONDecodeError:
        return lambda_response(400, {'error': 'Invalid JSON in request body'})
    except Exception as e:
        print(f"Login error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})

def get_user(event, context):
    """
    Get current user profile and credit balance
    Requires valid JWT token
    """
    try:
        # Verify authentication
        user_payload = get_user_from_token(event)
        if not user_payload:
            return lambda_response(401, {'error': 'Invalid or expired token'})
        
        # Get fresh user data from database
        try:
            response = users_table.get_item(Key={'user_id': user_payload['user_id']})
            
            if 'Item' not in response:
                return lambda_response(404, {'error': 'User not found'})
            
            user_data = convert_decimals(response['Item'])
            
        except Exception as e:
            print(f"Error getting user: {e}")
            return lambda_response(500, {'error': 'Database error'})
        
        # Return user profile (exclude sensitive data)
        response_data = {
            'user_id': user_data['user_id'],
            'email': user_data['email'],
            'name': user_data.get('name', ''),
            'credits_balance': user_data.get('credits_balance', 0),
            'subscription_tier': user_data.get('subscription_tier', 'free'),
            'created_at': user_data.get('created_at'),
            'total_usage': user_data.get('total_usage', 0),
            'is_active': user_data.get('is_active', True)
        }
        
        return lambda_response(200, {'user': response_data})
        
    except Exception as e:
        print(f"Get user error: {e}")
        return lambda_response(500, {'error': 'Internal server error'})

# Utility function for other modules
def authenticate_request(event: Dict) -> tuple[Optional[Dict], Optional[Dict]]:
    """
    Authenticate request and return user data and error response
    Returns (user_data, error_response)
    """
    user_payload = get_user_from_token(event)
    if not user_payload:
        error_response = lambda_response(401, {'error': 'Authentication required'})
        return None, error_response
    
    try:
        response = users_table.get_item(Key={'user_id': user_payload['user_id']})
        
        if 'Item' not in response:
            error_response = lambda_response(404, {'error': 'User not found'})
            return None, error_response
        
        user_data = response['Item']
        
        if not user_data.get('is_active', True):
            error_response = lambda_response(401, {'error': 'Account deactivated'})
            return None, error_response
        
        return user_data, None
        
    except Exception as e:
        print(f"Authentication error: {e}")
        error_response = lambda_response(500, {'error': 'Authentication error'})
        return None, error_response