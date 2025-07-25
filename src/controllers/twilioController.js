// src/controllers/twilioController.js
import twilio from 'twilio';
import * as twilioCallService from '../services/twilioCallService.js';

// Controller to generate the initial TwiML for the call
export async function generateInitialCallTwiML(req, res) {
    const { appointmentId } = req.query; 

    try {
        const twimlResponse = await twilioCallService.initiateAppointmentFlow(appointmentId);
        res.type('text/xml');
        res.send(twimlResponse.toString());
    } catch (error) {
        console.error(`Error generating initial TwiML for appointment ${appointmentId}:`, error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Sorry, an error occurred. Goodbye.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
}

// Controller to process the audio recording from the call
export async function processCallRecording(req, res) {
    const { appointmentId } = req.query;
    const recordingUrl = req.body.RecordingUrl;
    
    try {
        await twilioCallService.handleAppointmentResponse(appointmentId, recordingUrl);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error(`Error processing recording for appointment ${appointmentId}:`, error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
}

// --- NEW: Controller to handle call status updates ---
export async function handleCallStatusUpdate(req, res) {
    const { appointmentId } = req.query;
    const { CallStatus, AnsweredBy } = req.body;

    try {
        await twilioCallService.updateCallStatus(appointmentId, CallStatus, AnsweredBy);
        res.status(200).send(); // Acknowledge receipt of the webhook
    } catch (error) {
        console.error(`Error updating call status for appointment ${appointmentId}:`, error);
        res.status(500).send();
    }
}
