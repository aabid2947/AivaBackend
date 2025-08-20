// src/controllers/googleTokenController.js
import { OAuth2Client } from 'google-auth-library';
import * as googleTokenService from '../services/googleTokenService.js';

const oAuth2Client = new OAuth2Client({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  // Remove the redirectUri from here - it should be set per request
});

export async function handleStoreUserGoogleTokens(req, res) {
  const userId = req.user?.id || req.user?.uid;
  const { code } = req.body;

  console.log('🔵 Handling Google OAuth token exchange:', {
    userId: userId ? 'present' : 'missing',
    code: code ? `${code.substring(0, 20)}...` : 'missing',
    clientId: process.env.GOOGLE_CLIENT_ID ? 'configured' : 'missing',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET ? 'configured' : 'missing'
  });

  if (!userId) {
    return res.status(401).json({ error: 'User not authenticated.' });
  }
  if (!code) {
    return res.status(400).json({ error: 'Authorization code is required.' });
  }

  try {
    // For mobile apps, we don't need a redirect_uri when exchanging the code
    // The mobile SDK handles the redirect internally
    const { tokens } = await oAuth2Client.getToken({
      code: code,
      // Don't include redirect_uri for mobile app auth codes
    });
    
    console.log('🟢 Successfully exchanged code for tokens:', {
      hasAccessToken: !!tokens.access_token,
      hasRefreshToken: !!tokens.refresh_token,
      hasIdToken: !!tokens.id_token,
      expiryDate: tokens.expiry_date,
      scope: tokens.scope
    });
    
    // Build the exact payload we want to store:
    const payload = {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: tokens.expiry_date,     
      scope: tokens.scope,
      idToken: tokens.id_token,
    };
    
    await googleTokenService.storeUserGoogleTokens(userId, payload);

    return res.status(200).json({ 
      message: 'Google tokens stored successfully.',
      // Optionally return some non-sensitive info
      scope: tokens.scope,
      hasRefreshToken: !!tokens.refresh_token
    });
  } catch (err) {
    console.error('🔴 Error exchanging code for tokens:', {
      error: err.response?.data || err.message,
      stack: err.stack,
      code: code ? `${code.substring(0, 20)}...` : 'missing'
    });
    
    const message =
      err.response?.data?.error_description ||
      err.response?.data?.error ||
      'Failed to exchange code for tokens.';
      
    return res.status(500).json({ error: message });
  }
}