// src/routes/twilioRoutes.js
import express from 'express';
import * as twilioController from '../controllers/twilioController.js';

const router = express.Router();

// This is the initial endpoint Twilio calls when the outbound call connects.
router.post('/twiML/appointmentCall', twilioController.generateInitialCallTwiML);

// This is the endpoint Twilio calls after recording the user's response.
router.post('/twiML/handleRecording', twilioController.processCallRecording);

// --- NEW: This endpoint handles status updates for the call ---
// (e.g., busy, no-answer, completed, or answering machine detection)
router.post('/twiML/callStatus', twilioController.handleCallStatusUpdate);

export default router;
