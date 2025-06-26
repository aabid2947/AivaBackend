// src/controllers/authController.js
import { authService } from '../services/authService.js';
import { userService } from '../services/userService.js'; // Import if you're using user profiles
import { errorHandler } from '../utils/errorHandler.js';

export const authController = {
  /**
   * Handles user signup.
   * Creates a user in Firebase Auth and optionally a profile in Firestore.
   * Expected request body: { email, password, displayName (optional) }
   */
  async signup(req, res) {
    try {
      const { email, password, displayName } = req.body;

      if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required.' });
      }
      console.log(req)
      // 1. Create user in Firebase Authentication
      const userRecord = await authService.createUser(email, password);

      // 2. Optionally, save additional user data to Firestore
      if (userService && userRecord.uid) {
        await userService.createUserProfile(userRecord.uid, { email, displayName });
      }

      res.status(201).json({
        message: 'User created successfully.',
        uid: userRecord.uid,
        email: userRecord.email,
      });
    } catch (error) {
      errorHandler(res, error, 'Signup failed.');
    }
  },

  /**
   * Handles user login.
   * Expects an ID token from the client-side Firebase login.
   * Verifies the ID token and returns user information.
   * Expected request body: { idToken }
   */
  async login(req, res) {
    try {
      const { idToken } = req.body;

      if (!idToken) {
        return res.status(400).json({ message: 'ID token is required.' });
      }

      // 1. Verify the ID token on the backend using Firebase Admin SDK
      const decodedToken = await authService.verifyIdToken(idToken);

      // 2. Optionally, retrieve user profile from Firestore
      let userProfile = null;
      if (userService && decodedToken.uid) {
        userProfile = await userService.getUserProfile(decodedToken.uid);
      }

      res.status(200).json({
        message: 'Login successful.',
        uid: decodedToken.uid,
        email: decodedToken.email,
        profile: userProfile,
      });
    } catch (error) {
      errorHandler(res, error, 'Login failed.');
    }
  },

  /**
   * Example of a protected route to get user data.
   * Requires a valid Firebase ID token in the Authorization header (Bearer token).
   * The 'authMiddleware' will populate 'req.user' with decoded token claims.
   */
  async getMe(req, res) {
    try {
      const user = req.user;

      let userProfile = null;
      if (userService && user.uid) {
        userProfile = await userService.getUserProfile(user.uid);
      }

      res.status(200).json({
        message: 'User data retrieved successfully.',
        user: {
          uid: user.uid,
          email: user.email,
          profile: userProfile,
        },
      });
    } catch (error) {
      errorHandler(res, error, 'Failed to retrieve user data.');
    }
  },
};
