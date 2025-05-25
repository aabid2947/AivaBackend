// src/config/firebaseAdmin.js
import admin from 'firebase-admin';
// We no longer need path, fileURLToPath, or fs if we're parsing directly from ENV
// import path from 'path';
// import { fileURLToPath } from 'url';
// import fs from 'fs';

let firebaseAdminInitialized = false;

export const initFirebaseAdmin = () => {
  if (firebaseAdminInitialized) {
    return; // Already initialized
  }

  // Use a different environment variable name, e.g., FIREBASE_SERVICE_ACCOUNT_JSON
  // to avoid confusion with a file path.
  const serviceAccountJsonString = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;

  if (!serviceAccountJsonString) {
    console.error('ERROR: FIREBASE_SERVICE_ACCOUNT_JSON environment variable is not set.');
    console.error('Please add the full JSON content of your service account key to this variable in your .env file or Vercel environment settings.');
    process.exit(1); // Exit if critical config is missing
  }

  try {
    // Parse the JSON string directly from the environment variable
    const serviceAccount = JSON.parse(serviceAccountJsonString);

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      // databaseURL: "https://<YOUR_PROJECT_ID>.firebaseio.com" // Uncomment and update if using Realtime Database
    });
    firebaseAdminInitialized = true;
    console.log('Firebase Admin SDK initialized successfully.');
  } catch (error) {
    console.error('ERROR: Failed to initialize Firebase Admin SDK:', error.message);
    console.error('Please ensure FIREBASE_SERVICE_ACCOUNT_JSON contains valid JSON content and is correctly formatted.');
    console.error('Specifically check for escaped characters if you copied it directly.');
    process.exit(1);
  }
};

// Export Firebase services instances
export const getFirebaseAuth = () => admin.auth();
export const getFirestore = () => admin.firestore(); // Export Firestore if needed
export { admin };