// src/routes/aivaRoutes.js
import express from 'express';
const router = express.Router();
// Assuming your controller file is indeed aivaController.js and exports named functions
import * as aivaController from '../controllers/aivaController.js';
// Assuming your authMiddleware.js uses a named export `authMiddleware`
import { authMiddleware } from '../middleware/authMiddleware.js';

// List all chat sessions for the authenticated user
router.get('/chats', authMiddleware, aivaController.listUserAivaChats);

// Create a new chat session
router.post('/chats', authMiddleware, aivaController.performCreateNewAivaChat);

// Get messages for a specific chat session
router.get('/chats/:chatId/messages', authMiddleware, aivaController.getAivaChatMessages); // New Route Added

// Send a message to an existing chat session
router.post('/chats/interact', authMiddleware, aivaController.handleAivaChatInteraction);

// Delete a specific chat session
router.delete('/chats/:chatId', authMiddleware, aivaController.performDeleteAivaChat);

export default router;
