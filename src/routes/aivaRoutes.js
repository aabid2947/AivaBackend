// src/routes/aivaRoutes.js
import express from 'express'
const router = express.Router();
import * as  aivaController from '../controllers/aivaController.js';
import  {authMiddleware} from '../middleware/authMiddleware.js'; // Assuming you have this for JWT

// POST /api/aiva/interact
// Protected route, requires authentication
router.post('/interact', authMiddleware, aivaController.handleAivaInteraction);

export default router
