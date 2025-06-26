// server.js or server.mjs
import 'dotenv/config'; // Automatically loads .env without needing extra code
import express from 'express';
import cors from 'cors';
import { initFirebaseAdmin } from './src/config/firebaseAdmin.js';
import authRoutes from './src/routes/authRoutes.js';
// Import feature routes
import reminderRoutes from './src/routes/reminderRoutes.js';
import morgan from 'morgan';
import aivaRoutes from './src/routes/aivaRoutes.js';
import googleTokenRoutes from './src/routes/googleTokenRoutes.js';
import twilioRoutes from './src/routes/twilioRoutes.js';
import audioRoutes from './src/routes/audioRoutes.js'; // 1. IMPORT the new audio routes
import './src/cron/emailScheduler.js';
import './src/cron/reminderScheduler.js'
const app = express();
const PORT = process.env.PORT || 5000;

// Initialize Firebase Admin SDK
initFirebaseAdmin();

// Middleware
app.use(cors());
app.use(express.json()); // For parsing application/json
app.use(express.urlencoded({ extended: true })); // For parsing application/x-www-form-urlencoded
app.use(morgan('tiny'));

// Auth Routes
app.use('/api/auth', authRoutes);

// Feature Routes
app.use('/api/reminders', reminderRoutes);
app.use('/api/google-tokens', googleTokenRoutes);
app.use('/api/aiva', aivaRoutes);
app.use('/api/twilio', twilioRoutes);
app.use('/api/audio', audioRoutes); // 2. USE the new audio routes under the /api/audio path

// Basic error handler
app.use((err, req, res, next) => {
console.error(err.stack);
res.status(500).send('Something broke\!');
});
console.log(process.env.GEMINI_API_KEY)
// Basic health check route
app.get('/api/health', (req, res) => {
res.status(200).json({ status: 'ok', message: 'AIVA API is running\!' });
});

// Global error handling middleware
app.use((err, req, res, next) => {
console.error("Global Error Handler Caught:");
console.error(err.stack);
if (res.headersSent) {
return next(err);
}
res.status(500).json({ message: 'Something broke on the server\!' });
});

app.listen(PORT, () => {
console.log(`AIVA API Server running on port ${PORT}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
