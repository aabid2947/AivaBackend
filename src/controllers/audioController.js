// src/controllers/audioController.js

import { transcribeAudio } from '../utils/speechToTextClient.js';
import * as aivaController from './aivaController.js'; // Import the existing AIVA controller

/**
 * Handles incoming audio commands, transcribes them, and passes to AIVA.
 * Expected multipart/form-data:
 * - Field 'audio': The audio file (e.g., .wav, .flac, .mp3)
 * - Field 'chatId': The ID of the AIVA chat session (text field)
 */
export async function handleAudioCommand(req, res) {
    try {
        // Ensure user is authenticated
        const userId = req.user?.id || req.user?.uid;
        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated.' });
        }

        // Ensure audio file is present
        if (!req.file) {
            return res.status(400).json({ error: 'No audio file uploaded.' });
        }

        // Ensure chatId is present in the body (from multipart form data)
        const { chatId } = req.body;
        if (!chatId) {
            return res.status(400).json({ error: 'chatId is required in the request body.' });
        }

        const audioBuffer = req.file.buffer; // The audio file buffer from multer
        const mimeType = req.file.mimetype; // e.g., 'audio/wav', 'audio/mpeg'

        // Determine encoding and sample rate based on MIME type or assume defaults
        // For production, you might want more robust MIME type parsing or client-side metadata.
        let encoding;
        let sampleRateHertz;

        if (mimeType.includes('wav') || mimeType.includes('flac')) {
            encoding = 'LINEAR16'; // Common for WAV/FLAC
            sampleRateHertz = 16000; // Common default, adjust as per your audio
        } else if (mimeType.includes('mpeg') || mimeType.includes('mp3')) {
            encoding = 'MP3';
            sampleRateHertz = 16000; // Common default, adjust as per your audio
        } else {
            console.warn(`Unsupported audio MIME type: ${mimeType}. Attempting LINEAR16.`);
            encoding = 'LINEAR16'; // Fallback
            sampleRateHertz = 16000;
        }

        // 1. Transcribe the audio to text
        const transcribedText = await transcribeAudio(audioBuffer, encoding, sampleRateHertz);

        if (!transcribedText || transcribedText.trim() === '') {
            return res.status(400).json({ error: 'Could not transcribe audio. Please try again.' });
        }

        console.log(`Audio transcribed to: "${transcribedText}"`);

        // 2. Call the AIVA controller's chat interaction function with the transcribed text
        // We'll mimic the request structure expected by handleAivaChatInteraction
        req.body.message = transcribedText; // Set the transcribed text as the message

        // IMPORTANT: Because handleAivaChatInteraction expects `req` and `res`,
        // and we want it to write directly to our current `res`, we just call it.
        // It will handle sending the response.
        await aivaController.handleAivaChatInteraction(req, res);

    } catch (error) {
        console.error('Error in handleAudioCommand:', error);
        // If handleAivaChatInteraction has already sent a response, avoid sending another.
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Failed to process audio command.', details: error.message });
        }
    }
}
