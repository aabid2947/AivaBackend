// src/controllers/twilioController.js
import twilio from 'twilio';
import * as twilioCallService from '../services/twilioCallService.js';

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