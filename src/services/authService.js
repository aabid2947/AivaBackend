// src/services/authService.js
// This service file task is to handle user login and signup
import { getFirebaseAuth } from '../config/firebaseAdmin.js';



export const authService = {
  /**
   * Creates a new user in Firebase Authentication.
   * This is typically called by the backend for signup.
   * @param {string} email
   * @param {string} password
   * @returns {Promise<admin.auth.UserRecord>} Firebase UserRecord object.
   * @throws {Error} If Firebase Auth operation fails.
   */
  async createUser(email, password) {
    try {
      const auth = getFirebaseAuth();
      const userRecord = await auth.createUser({ email, password });
      return userRecord;
    } catch (error) {
      console.error('AuthService: Error creating user:', error);
      throw error; // Re-throw to be caught by controller's error handler
    }
  },

  /**
   * Verifies a Firebase ID token sent from the client.
   * This is used by the backend to confirm a user's identity after client-side login.
   * @param {string} idToken - The ID token obtained from Firebase Client SDK.
   * @returns {Promise<admin.auth.DecodedIdToken>} Decoded ID token claims.
   * @throws {Error} If the token is invalid or expired.
   */
  async verifyIdToken(idToken) {
    try {
      const auth = getFirebaseAuth();
      const decodedToken = await auth.verifyIdToken(idToken);
      return decodedToken;
    } catch (error) {
      console.error('AuthService: Error verifying ID token:', error);
      throw error; // Re-throw to be caught by controller's error handler
    }
  },

  // Add other auth-related functions if needed (e.g., password reset, custom token generation)
};
