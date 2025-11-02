// server.js or server.mjs
import 'dotenv/config'; // Automatically loads .env without needing extra code
import express from 'express';
import cors from 'cors';
import { initFirebaseAdmin } from './src/config/firebaseAdmin.js';
import authRoutes from './src/routes/authRoutes.js';
// Import feature routes
// import reminderRoutes from './src/routes/reminderRoutes.js';
import morgan from 'morgan';
import aivaRoutes from './src/routes/aivaRoutes.js';
import googleTokenRoutes from './src/routes/googleTokenRoutes.js';
import twilioRoutes from './src/routes/twilioRoutes.js';
// import audioRoutes from './src/routes/audioRoutes.js'; // 1. IMPORT the new audio routes
// import './src/cron/emailScheduler.js';
// import './src/cron/reminderScheduler.js'
import './src/cron/appointmentScheduler.js'
import mpesaRoutes from './src/routes/mpesaRoutes.js';
import appointmentRoutes from './src/routes/appointmentRoutes.js'
// import { test } from './src/cron/appointmentScheduler.js';

import { createServer } from 'http'; // 1. Import Node's native HTTP server
import { setupWebSocketServer } from './src/services/twilioCallServer.js'; // 2. Import the new WebSocket server
import { setupTwilioStreamRoutes } from './src/routes/twilioStreamRoutes.js'; // 3. Import the new TwiML route

const app = express();
const PORT = process.env.PORT || 5000;

// 🛠️ Trust the first proxy - this fixes the WebSocket protocol detection
app.set('trust proxy', 1);

// Initialize Firebase Admin SDK
initFirebaseAdmin();

// Middleware
app.use(cors());

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ 
    limit: '50mb', 
    extended: true 
})); // For parsing application/x-www-form-urlencoded
app.use(morgan('tiny'));

// Custom middleware to handle payload too large errors
app.use((err, req, res, next) => {
    if (err.type === 'entity.too.large') {
        return res.status(413).json({
            error: 'File too large for server',
            maxSize: '50MB',
            suggestion: 'Please reduce file size to under 50MB.'
        });
    }
    next(err);
});

// Auth Routes
app.use('/api/auth', authRoutes);
// Feature Routes
// app.use('/api/reminders', reminderRoutes);
app.use('/api/google-tokens', googleTokenRoutes);
app.use('/api/aiva', aivaRoutes);
app.use('/api/twilio', twilioRoutes);
// app.use('/api/audio', audioRoutes); // 2. USE the new audio routes under the /api/audio path
app.use('/api/payments', mpesaRoutes);
// --- NEW ---
app.use('/api/appointments', appointmentRoutes); // Use appointment routes
setupTwilioStreamRoutes(app);
// test()
// Basic error handler
app.use((err, req, res, next) => {
console.error(err.stack);
res.status(500).send('Something broke\!');
});

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


// app.listen(PORT, () => {
// console.log(`AIVA API Server running on port ${PORT}`);
// console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
// });


const server = createServer(app); // 5. Create an HTTP server from the Express app

setupWebSocketServer(server); // 6. Pass the HTTP server to your WebSocket setup

// *** UPDATED: Make the HTTP server listen, not the app ***
server.listen(PORT, () => { // 7. Change 'app.listen' to 'server.listen'
console.log(`AIVA API Server running on port ${PORT}`);
console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
console.log(`WebSocket server initialized.`);
});