// src/routes/emailRoutes.js
import express from 'express';
import { emailController } from '../controllers/emailController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware); // Apply authMiddleware to all email routes

// Route to set/update email monitoring preferences
router.post('/preferences', emailController.updateEmailPreferences);

// Route to get an email summary (placeholder for now)
router.get('/summary', emailController.fetchEmailSummary);

export default router;