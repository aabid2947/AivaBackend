// src/routes/twilioRoutes.js
import express from 'express';
import * as twilioController from '../controllers/twilioController.js';

const router = express.Router();

// This is the initial endpoint Twilio calls when the outbound call connects.
// It starts the conversation.
router.post('/twiML/appointmentCall', twilioController.generateInitialCallTwiML);

// This is the endpoint Twilio calls after recording the user's response.
// It processes the recording and decides the next steps.
router.post('/twiML/handleRecording', twilioController.processCallRecording);


export default router;
