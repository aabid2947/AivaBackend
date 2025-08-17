// src/controllers/googleTokenController.js
// import * as googleTokenService from '../services/googleTokenService.js';

// export async function handleStoreUserGoogleTokens(req, res) {
//   try {
//     const userId = req.user?.id || req.user?.uid;
//     if (!userId) {
//       return res.status(401).json({ error: 'User not authenticated.' });
//     }

//     const tokenData = req.body; // Expects { accessToken, refreshToken?, expiresIn?, scope?, idToken? }
//     if (!tokenData || !tokenData.accessToken) {
//       return res.status(400).json({ error: 'Access token is required in the request body.' });
//     }

//     await googleTokenService.storeUserGoogleTokens(userId, tokenData);
//     return res.status(200).json({ message: 'Google OAuth tokens stored successfully.' });
//   } catch (error) {
//     console.error('Error in handleStoreUserGoogleTokens controller:', error);
//     if (error.message.includes('required')) {
//         return res.status(400).json({ error: error.message });
//     }
//     return res.status(500).json({ error: 'Failed to store Google OAuth tokens.' });
//   }
// }
// src/controllers/googleTokenController.js


// export async function handleStoreUserGoogleTokens(req, res) {
//   const userId = req.user?.id || req.user?.uid;
//   if (!userId) {
//     return res.status(401).json({ error: 'User not authenticated.' });
//   }

//   const { code } = req.body;
//   if (!code) {
//     return res.status(400).json({ error: 'Authorization code is required.' });
//   }

//   try {
//     // Exchange the code for tokens
//     const { tokens } = await oAuth2Client.getToken({
//       code,
//       redirect_uri: process.env.GOOGLE_REDIRECT_URI,
//     });
//     console.log(process.env.GOOGLE_REDIRECT_URI)
//     // tokens = { access_token, refresh_token, scope, expiry_date, id_token }
//     await googleTokenService.storeUserGoogleTokens(userId, tokens);

//     return res.status(200).json({ message: 'Google tokens stored successfully.' });
//   } catch (err) {
//     console.error('Error exchanging code for tokens:', err);
//     return res.status(500).json({ error: 'Failed to exchange code for tokens.' });
//   }
// }


// src/controllers/googleTokenController.js
// src/controllers/googleTokenController.js
import { OAuth2Client } from 'google-auth-library';
import * as googleTokenService from '../services/googleTokenService.js';

// Initialize the client with all necessary credentials
const oAuth2Client = new OAuth2Client({
  clientId:     process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_CLIENT_SECRET,
  redirectUri:  process.env.GOOGLE_REDIRECT_URI, // Set the redirect URI here
});

export async function handleStoreUserGoogleTokens(req, res) {
  const userId = req.user?.id || req.user?.uid;
  const { code } = req.body;

  if (!userId) {
    return res.status(401).json({ error: 'User not authenticated.' });
  }
  if (!code) {
    return res.status(400).json({ error: 'Authorization code is required.' });
  }

  try {
    // CORRECTED: The library will now automatically use the redirectUri set above
    const { tokens } = await oAuth2Client.getToken(code);
    
    // Build the exact payload we want to store
    const payload = {
      accessToken:  tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt:    tokens.expiry_date,     
      scope:        tokens.scope,
      idToken:      tokens.id_token,
    };
    await googleTokenService.storeUserGoogleTokens(userId, payload);

    return res.status(200).json({ message: 'Google tokens stored successfully.' });
  } catch (err) {
    console.error('🔴 Error exchanging code for tokens:', err.response?.data || err);
    const message =
      err.response?.data?.error_description ||
      err.response?.data?.error ||
      'Failed to exchange code for tokens.';
    return res.status(500).json({ error: message });
  }
}