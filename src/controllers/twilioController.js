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

// Replaces processCallRecording to handle transcribed speech from <Gather>
export async function handleSpokenResponse(req, res) {
    const { appointmentId } = req.query;
    const transcribedText = req.body.SpeechResult;
    const timedOut = req.query.timedOut === 'true';

    console.log(`[INFO] handleSpokenResponse: Appt ${appointmentId}. Timed Out: ${timedOut}. Transcription: "${transcribedText}"`);

    try {
        const twiml = await twilioCallService.handleAppointmentResponse(appointmentId, transcribedText, timedOut);
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error(`Error handling spoken response for appointment ${appointmentId}:`, error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Sorry, an error occurred on our end. Goodbye.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
}

// --- ADDED: Controller function for handling the final confirmation ---
export async function handleFinalConfirmation(req, res) {
    const { appointmentId, timeToConfirm } = req.query;
    const transcribedText = req.body.SpeechResult;
    const timedOut = req.query.timedOut === 'true';

    console.log(`[INFO] handleFinalConfirmation: Appt ${appointmentId}. Timed Out: ${timedOut}. Transcription: "${transcribedText}"`);

    try {
        const twiml = await twilioCallService.handleConfirmationResponse(appointmentId, transcribedText, timeToConfirm, timedOut);
        res.type('text/xml');
        res.send(twiml.toString());
    } catch (error) {
        console.error(`Error handling final confirmation for appointment ${appointmentId}:`, error);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say('Sorry, an internal error occurred. Goodbye.');
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
}


// Controller to handle call status updates
export async function handleCallStatusUpdate(req, res) {
    const { appointmentId } = req.query;
    const { CallStatus, AnsweredBy } = req.body;

    console.log(`[INFO] Call Status Webhook: Received status '${CallStatus}' for appointmentId: ${appointmentId}. AnsweredBy: '${AnsweredBy || 'N/A'}'.`);

    try {
        await twilioCallService.updateCallStatus(appointmentId, CallStatus, AnsweredBy);
        res.status(200).send('OK');
    } catch (error) {
        console.error(`[ERROR] handleCallStatusUpdate: Failed to process status for appointment ${appointmentId}. Error: ${error.message}`);
        res.status(500).send('Error processing status update.');
    }
}