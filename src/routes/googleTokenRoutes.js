// src/routes/googleTokenRoutes.js
import express from 'express';
import * as googleTokenController from '../controllers/googleTokenController.js';
import { authMiddleware } from '../middleware/authMiddleware.js'; // Assuming you have this

const router = express.Router();

// Route to store Google OAuth tokens received from the frontend
// push this 

router.post('/store', authMiddleware, googleTokenController.handleStoreUserGoogleTokens);

export default router;