// server.js or server.mjs
import 'dotenv/config'; // Automatically loads .env without needing extra code
import express from 'express'; //
import cors from 'cors'; //
import { initFirebaseAdmin } from './src/config/firebaseAdmin.js'; // note the .js extension for ESM imports
import authRoutes from './src/routes/authRoutes.js'; //

// Import new feature routes
import reminderRoutes from './src/routes/reminderRoutes.js'; 
import  aivaRoutes from './src/routes/aivaRoutes.js';
import googleTokenRoutes from './src/routes/googleTokenRoutes.js'; 
const app = express(); //
const PORT = process.env.PORT || 5000; //

// Initialize Firebase Admin SDK
initFirebaseAdmin(); //

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON request bodies

// Auth Routes
app.use('/api/auth', authRoutes); //

// Feature Routes (User Needs Management)
// These routes will be protected by the authMiddleware defined within their respective route files.
app.use('/api/reminders', reminderRoutes);
app.use('/api/google-tokens', googleTokenRoutes); // Add this
app.use('/api/aiva', aivaRoutes);


// Basic error handler (optional, can be more sophisticated)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Basic health check route
app.get('/api/health', (req, res) => { //
  res.status(200).json({ status: 'ok', message: 'AIVA API is running!' }); //
});

// Global error handling middleware (optional but good practice)
app.use((err, req, res, next) => { //
  console.error("Global Error Handler Caught:"); //
  console.error(err.stack); //
  // Check if the response has already been sent
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ message: 'Something broke on the server!' }); //
});

app.listen(PORT, () => { //
  console.log(`AIVA API Server running on port ${PORT}`); //
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`); //
});