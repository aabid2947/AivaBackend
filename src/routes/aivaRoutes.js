// src/routes/aivaRoutes.js
import express from 'express'
const router = express.Router();
import * as  aivaController from '../controllers/aivaController.js';
import  {authMiddleware} from '../middleware/authMiddleware.js'; // Assuming you have this for JWT

// POST /api/aiva/interact
// Protected route, requires authentication
router.post('/chats', authMiddleware, aivaController.performCreateNewAivaChat);

router.get('/chats', authMiddleware, aivaController.listUserAivaChats);


// Send a message to an existing chat session
// We'll expect chatId in the request body for this one to keep URL simpler
router.post('/chats/interact', authMiddleware, aivaController.handleAivaChatInteraction);

// Delete a specific chat session
router.delete('/chats/:chatId', authMiddleware, aivaController.performDeleteAivaChat);

export default router
