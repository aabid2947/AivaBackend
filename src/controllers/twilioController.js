// src/controllers/twilioController.js
import twilio from 'twilio';
import * as twilioCallService from '../services/twilioCallService.js';

// Controller to generate the initial TwiML for the call
export async function generateInitialCallTwiML(req, res) {
    // The appointmentId is passed as a query parameter from the scheduler
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
    const recordingUrl = req.body.RecordingUrl; // URL of the recorded audio
    
    try {
        // The service will handle downloading, transcribing, and updating the database
        await twilioCallService.handleAppointmentResponse(appointmentId, recordingUrl);

        // After processing, we end the call gracefully.
        // The response to this webhook should be an empty TwiML response to hang up.
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.hangup();

        res.type('text/xml');
        res.send(twiml.toString());

    } catch (error) {
        console.error(`Error processing recording for appointment ${appointmentId}:`, error);
        // In case of an error during processing, just hang up. The error is logged.
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.hangup();
        res.type('text/xml');
        res.send(twiml.toString());
    }
}
