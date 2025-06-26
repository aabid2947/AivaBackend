// src/services/googleTokenService.js
// Thsi file is used as a service to store google auth token after oAuth 
import { db } from '../config/firebaseAdmin.js';
import { FieldValue } from 'firebase-admin/firestore';

const USER_COLLECTION = 'users';
const GOOGLE_TOKENS_SUBCOLLECTION = 'googleOAuthTokens'; // Stored in a private subcollection

/**
 * Stores Google OAuth tokens for a user.
 * @param {string} userId The user's ID.
 * @param {object} tokenData Object containing accessToken, refreshToken, expiresIn, etc.
 * @returns {Promise<void>}
 */
export async function storeUserGoogleTokens(userId, tokenData) {
  if (!userId || !tokenData || !tokenData.accessToken) {
    throw new Error('User ID and valid token data (including accessToken) are required.');
  }
  
  const { accessToken, refreshToken, expiresAt, scope, idToken } = tokenData; // idToken might be useful for user email
  console.log(tokenData)
  const tokensRef = db.collection(USER_COLLECTION).doc(userId).collection(GOOGLE_TOKENS_SUBCOLLECTION).doc('default'); // Using 'default' as doc ID for simplicity

  const expiresIn =
    typeof expiresAt === 'number'
      ? Math.floor((expiresAt - Date.now()) / 1000)
      : undefined;

  const dataToStore = {
    accessToken,
    refreshToken, // Crucial for long-term access
    ...(expiresIn != null && { expiresIn }),
    grantedAt: FieldValue.serverTimestamp(),
    scope, // Store the scopes granted
    updatedAt: FieldValue.serverTimestamp(),
  };

  if (idToken) {
    // Optionally decode idToken to get user's email if not already stored,
    // but ensure you verify it properly or trust the source.
    // For now, just store it if provided.
    dataToStore.idToken = idToken;
  }

  try {
    await tokensRef.set(dataToStore, { merge: true });
    console.log(`Google OAuth tokens stored successfully for user ${userId}.`);

    // Also, set/update user's email monitoring preference if it's being enabled now
    // This might be better handled in a user settings service or directly
    const userRef = db.collection(USER_COLLECTION).doc(userId);
    await userRef.set({
        settings: {
            isGoogleMailIntegrated: true,
            // emailMonitoringPreference will be set via Aiva chat flow later
        }
    }, { merge: true });
    console.log(`User ${userId} marked as Google Mail integrated.`);

  } catch (error) {
    console.error(`Error storing Google OAuth tokens for user ${userId}:`, error);
    throw error;
  }
}

/**
 * Retrieves Google OAuth tokens for a user.
 * @param {string} userId The user's ID.
 * @returns {Promise<object|null>} The stored token data or null if not found.
 */
export async function getUserGoogleTokens(userId) {
  if (!userId) {
    throw new Error('User ID is required to retrieve tokens.');
  }
  const tokensRef = db.collection(USER_COLLECTION).doc(userId).collection(GOOGLE_TOKENS_SUBCOLLECTION).doc('default');
  const docSnap = await tokensRef.get();

  if (!docSnap.exists) {
    console.log(`No Google OAuth tokens found for user ${userId}.`);
    return null;
  }
  return docSnap.data();
}