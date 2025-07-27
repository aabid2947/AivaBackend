// src/routes/twilioRoutes.js
import express from 'express';
import * as twilioController from '../controllers/twilioController.js';

const router = express.Router();

// This is the initial endpoint Twilio calls when the outbound call connects.
router.post('/twiML/appointmentCall', twilioController.generateInitialCallTwiML);

// --- UPDATED: This route now correctly points to the function handling spoken responses ---
router.post('/twiML/handleRecording', twilioController.handleSpokenResponse);

// This endpoint handles status updates for the call
router.post('/twiML/callStatus', twilioController.handleCallStatusUpdate);

export default router;