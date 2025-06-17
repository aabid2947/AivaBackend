// src/routes/audioRoutes.js

import express from 'express';
import multer from 'multer'; // Import multer for handling multipart/form-data
import { authMiddleware } from '../middleware/authMiddleware.js'; // Assuming you have authMiddleware
import * as audioController from '../controllers/audioController.js'; // Import the new audio controller

const router = express.Router();

// Configure multer for in-memory storage.
// This is suitable for smaller audio files. For very large files,
// consider disk storage or streaming directly to Google Cloud Storage.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 10 * 1024 * 1024, // Limit audio file size to 10MB
    },
});

// Route for handling audio commands
// Uses authMiddleware for user authentication
// Uses multer middleware to parse 'audio' field as a single file
router.post(
    '/',
    authMiddleware, // Authenticate the user
    upload.single('audio'), // 'audio' is the name of the form field for the file
    audioController.handleAudioCommand // Process the transcribed audio
);

export default router;
