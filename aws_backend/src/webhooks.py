"""
Webhook handlers for payment processing and external integrations
"""

import json
import os
import stripe
from typing import Dict, Any
from .auth import lambda_response
from .credits import add_credits

# Stripe configuration
stripe.api_key = os.environ['STRIPE_SECRET_KEY']
STRIPE_WEBHOOK_SECRET = os.environ['STRIPE_WEBHOOK_SECRET']

def stripe_handler(event, context):
    """
    Handle Stripe webhook events for payment processing
    """
    try:
        # Get the raw body and signature (handle case-sensitive headers)
        payload = event['body']
        sig_header = event['headers'].get('stripe-signature') or event['headers'].get('Stripe-Signature')
        
        print(f"🔍 WEBHOOK: Headers received: {list(event['headers'].keys())}")
        print(f"🔍 WEBHOOK: Signature header found: {bool(sig_header)}")
        
        if not sig_header:
            return lambda_response(400, {'error': 'Missing Stripe signature'})
        
        # Verify webhook signature
        try:
            stripe_event = stripe.Webhook.construct_event(
                payload, sig_header, STRIPE_WEBHOOK_SECRET
            )
        except ValueError:
            return lambda_response(400, {'error': 'Invalid payload'})
        except stripe.error.SignatureVerificationError:
            return lambda_response(400, {'error': 'Invalid signature'})
        
        # Handle the event
        if stripe_event['type'] == 'checkout.session.completed':
            return handle_successful_payment(stripe_event['data']['object'])
        elif stripe_event['type'] == 'checkout.session.expired':
            return handle_expired_payment(stripe_event['data']['object'])
        elif stripe_event['type'] == 'invoice.payment_failed':
            return handle_failed_payment(stripe_event['data']['object'])
        else:
            print(f"Unhandled event type: {stripe_event['type']}")
            return lambda_response(200, {'status': 'ignored'})
        
    except Exception as e:
        print(f"Stripe webhook error: {e}")
        return lambda_response(500, {'error': 'Webhook processing failed'})

def handle_successful_payment(session: Dict) -> Dict:
    """
    Handle successful payment completion
    Add credits to user account
    """
    try:
        print(f"🎉 WEBHOOK: Processing successful payment for session: {session.get('id')}")
        print(f"📋 WEBHOOK: Session data: {session}")
        
        # Extract metadata from the session
        metadata = session.get('metadata', {})
        user_id = metadata.get('user_id')
        credits = int(metadata.get('credits', 0)) if metadata.get('credits') else 0
        package_id = metadata.get('package_id')
        
        print(f"🔍 WEBHOOK: Extracted metadata - user_id: {user_id}, credits: {credits}, package_id: {package_id}")
        
        if not user_id or not credits:
            print(f"❌ WEBHOOK: Missing required metadata in session: {session['id']}")
            print(f"📋 WEBHOOK: Available metadata: {metadata}")
            return lambda_response(400, {'error': 'Missing metadata'})
        
        # Add credits to user account
        print(f"💳 WEBHOOK: Adding {credits} credits to user {user_id}")
        success = add_credits(user_id, credits, session['id'])
        
        if success:
            print(f"✅ WEBHOOK: Successfully added {credits} credits to user {user_id}")
            
            return lambda_response(200, {
                'status': 'success',
                'credits_added': credits,
                'user_id': user_id
            })
        else:
            print(f"❌ WEBHOOK: Failed to add credits for user {user_id}")
            return lambda_response(500, {'error': 'Failed to process credits'})
        
    except Exception as e:
        print(f"💥 WEBHOOK: Payment processing error: {e}")
        import traceback
        print(f"🔍 WEBHOOK: Full traceback: {traceback.format_exc()}")
        return lambda_response(500, {'error': 'Payment processing failed'})

def handle_expired_payment(session: Dict) -> Dict:
    """
    Handle expired checkout session
    Clean up any pending transactions
    """
    try:
        session_id = session['id']
        print(f"Checkout session expired: {session_id}")
        
        # Update transaction status to expired
        # This would require importing transactions_table and updating the record
        
        return lambda_response(200, {'status': 'expired_session_handled'})
        
    except Exception as e:
        print(f"Expired session handling error: {e}")
        return lambda_response(500, {'error': 'Failed to handle expired session'})

def handle_failed_payment(invoice: Dict) -> Dict:
    """
    Handle failed payment
    Log the failure and potentially notify the user
    """
    try:
        customer_id = invoice.get('customer')
        amount = invoice.get('amount_due')
        
        print(f"Payment failed for customer {customer_id}, amount: {amount}")
        
        # You could implement user notification here
        # notify_payment_failure(customer_id, amount)
        
        return lambda_response(200, {'status': 'payment_failure_handled'})
        
    except Exception as e:
        print(f"Failed payment handling error: {e}")
        return lambda_response(500, {'error': 'Failed to handle payment failure'})