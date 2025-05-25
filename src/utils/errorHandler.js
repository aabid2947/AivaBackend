// src/utils/errorHandler.js
export const errorHandler = (res, error, defaultMessage = 'An unexpected server error occurred', statusCode = 500) => {
  console.error('API Error:', error); // Log the full error for debugging on the server

  let message = defaultMessage;
  let customStatusCode = statusCode;

  // Customize error messages and status codes based on Firebase Auth error codes
  if (error.code) {
    switch (error.code) {
      case 'auth/email-already-in-use':
        message = 'The email address is already in use by another account.';
        customStatusCode = 409; // Conflict
        break;
      case 'auth/invalid-email':
        message = 'The email address is not valid.';
        customStatusCode = 400; // Bad Request
        break;
      case 'auth/weak-password':
        message = 'The password is too weak. It must be at least 6 characters long.';
        customStatusCode = 400;
        break;
      case 'auth/id-token-expired':
        message = 'Authentication token expired. Please log in again.';
        customStatusCode = 401; // Unauthorized
        break;
      case 'auth/argument-error':
      case 'auth/invalid-argument':
        message = 'Invalid request argument provided.';
        customStatusCode = 400;
        break;
      case 'auth/invalid-credential':
      case 'auth/user-not-found': // For ID token verification where user doesn't exist
        message = 'Invalid credentials or user not found.';
        customStatusCode = 401;
        break;
      // Add more Firebase Auth error codes as needed for specific client feedback
      default:
        // Use the error message from Firebase if it's more specific and not sensitive
        message = error.message || defaultMessage;
        break;
    }
  }

  res.status(customStatusCode).json({ message });
};
