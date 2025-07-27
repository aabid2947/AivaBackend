import express from 'express';
import * as twilioController from '../controllers/twilioController.js';

const router = express.Router();

// This is the initial endpoint Twilio calls when the outbound call connects.
router.post('/twiML/appointmentCall', twilioController.generateInitialCallTwiML);

router.post('/twiML/handleRecording', twilioController.handleSpokenResponse);

router.post('/twiML/handleConfirmation', twilioController.handleFinalConfirmation);

// This endpoint handles status updates for the call
router.post('/twiML/callStatus', twilioController.handleCallStatusUpdate);

export default router