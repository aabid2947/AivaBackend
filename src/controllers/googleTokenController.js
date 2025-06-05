// src/controllers/googleTokenController.js
import * as googleTokenService from '../services/googleTokenService.js';

export async function handleStoreUserGoogleTokens(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated.' });
    }

    const tokenData = req.body; // Expects { accessToken, refreshToken?, expiresIn?, scope?, idToken? }
    if (!tokenData || !tokenData.accessToken) {
      return res.status(400).json({ error: 'Access token is required in the request body.' });
    }

    await googleTokenService.storeUserGoogleTokens(userId, tokenData);
    return res.status(200).json({ message: 'Google OAuth tokens stored successfully.' });
  } catch (error) {
    console.error('Error in handleStoreUserGoogleTokens controller:', error);
    if (error.message.includes('required')) {
        return res.status(400).json({ error: error.message });
    }
    return res.status(500).json({ error: 'Failed to store Google OAuth tokens.' });
  }
}