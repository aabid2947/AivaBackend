// server.js or server.mjs
import 'dotenv/config'; // Automatically loads .env without needing extra code
import express from 'express';
import cors from 'cors';
import { initFirebaseAdmin } from './src/config/firebaseAdmin.js'; // note the .js extension for ESM imports
import authRoutes from './src/routes/authRoutes.js';

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Firebase Admin SDK
initFirebaseAdmin();

// Middleware
app.use(cors()); // Enable CORS for all routes
app.use(express.json()); // Parse JSON request bodies

// Routes
app.use('/api/auth', authRoutes);

// Basic health check route
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok', message: 'Firebase API is running!' });
});

// Global error handling middleware (optional)
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something broke on the server!' });
});

app.listen(PORT, () => {
  console.log(`Firebase API Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
