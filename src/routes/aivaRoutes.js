// src/routes/aivaRoutes.js
import express from 'express';
import multer from 'multer';
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
router.get('/chats/:chatId/messages', authMiddleware, aivaController.getAivaChatMessages); 

// Send a message to an existing chat session for standard interaction
router.post('/chats/interact', authMiddleware, aivaController.handleAivaChatInteraction);

// --- NEW ROUTE for Summarization ---
// Handles file upload (multipart/form-data) or text message (application/json)
router.post(
    '/chats/:chatId/summarize',
    authMiddleware,
    (req, res, next) => {
        aivaController.upload.single('file')(req, res, (err) => {
            if (err instanceof multer.MulterError) {
                if (err.code === 'LIMIT_FILE_SIZE') {
                    return res.status(413).json({ 
                        error: 'File too large. Maximum size is 50MB.',
                        maxSize: '50MB',
                        suggestion: 'Please reduce file size to under 50MB.'
                    });
                }
                return res.status(400).json({ 
                    error: `Upload error: ${err.message}` 
                });
            } else if (err) {
                return res.status(400).json({ 
                    error: err.message 
                });
            }
            next();
        });
    },
    aivaController.handleSummarizationRequest
);

// Delete a specific chat session
router.delete('/chats/:chatId', authMiddleware, aivaController.performDeleteAivaChat);

export default router;