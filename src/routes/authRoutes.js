// src/routes/authRoutes.js
import express from 'express';
import {authController} from '../controllers/authController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Public API endpoints for authentication
router.post('/signup', authController.signup);

// Login route (optionally accepts fcmToken)
router.post('/login', authController.login);

// Logout route
router.post('/logout', authController.logout);

// Protected API endpoint (requires a valid Firebase ID token)
// Use authMiddleware to protect this route
router.get('/me', authMiddleware, authController.getMe);

export default router;
