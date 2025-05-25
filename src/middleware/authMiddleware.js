// src/middleware/authMiddleware.js
import { authService } from '../services/authService.js';
import { errorHandler } from '../utils/errorHandler.js';

export const authMiddleware = async (req, res, next) => {
  try {
    // Get the ID token from the Authorization header (e.g., "Bearer <idToken>")
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Authorization header missing or malformed.' });
    }

    const idToken = authHeader.split('Bearer ')[1];

    // Verify the ID token using Firebase Admin SDK
    const decodedToken = await authService.verifyIdToken(idToken);

    // Attach the decoded token (user claims) to the request object
    // This makes user data available in subsequent controllers
    req.user = decodedToken;
    next(); // Proceed to the next middleware or route handler
  } catch (error) {
    // If token verification fails, send an unauthorized response
    errorHandler(res, error, 'Authentication failed. Invalid or expired token.', 401);
  }
};
