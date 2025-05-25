// src/services/userService.js
import { getFirestore, admin } from '../config/firebaseAdmin.js';


export const userService = {
    /**
     * Creates or updates a user's profile document in Firestore.
     * @param {string} uid - User ID from Firebase Auth.
     * @param {object} userData - Data to store (e.g., { email, displayName }).
     * @returns {Promise<void>}
     * @throws {Error} If Firestore operation fails.
    */
   async createUserProfile(uid, userData) {
       try {
        const db = getFirestore();
      await db.collection('users').doc(uid).set(
        {
          ...userData,
          createdAt: admin.firestore.FieldValue.serverTimestamp(), // Use server timestamp
        },
        { merge: true } // Use merge to avoid overwriting existing fields
      );
      console.log(`UserService: User profile created/updated for UID: ${uid}`);
    } catch (error) {
      console.error('UserService: Error creating/updating user profile:', error);
      throw error;
    }
  },

  /**
   * Retrieves a user's profile document from Firestore.
   * @param {string} uid - User ID.
   * @returns {Promise<object | null>} User profile data or null if not found.
   * @throws {Error} If Firestore operation fails.
   */
  async getUserProfile(uid) {
    try {
        const db = admin.firestore();
      const doc = await db.collection('users').doc(uid).get();
      if (doc.exists) {
        return { id: doc.id, ...doc.data() };
      }
      return null;
    } catch (error) {
      console.error('UserService: Error getting user profile:', error);
      throw error;
    }
  },
  // Add other user-related Firestore operations (e.g., updateProfile, deleteProfile)
};
