// src/services/twilioCallService.js
import twilio from 'twilio';
import { db } from '../config/firebaseAdmin.js';
import { generateGeminiAudioTranscription, generateGeminiText } from '../utils/geminiClient.js';
import axios from 'axios';

const getTranscriptionAnalysisPrompt = (transcribedText) => {
    return `A user was asked if a proposed appointment time was okay, or to suggest an alternative.
    Their spoken response was: "${transcribedText}"

    Analyze this response and classify it into one of three categories: "CONFIRMED", "RESCHEDULE", or "UNCLEAR".
    - If the user agrees (e.g., "yes", "that's fine", "okay"), respond with a JSON object like: {"status": "CONFIRMED"}
    - If the user suggests a new time (e.g., "how about tomorrow at 2pm?", "no, I need something in the evening"), respond with a JSON object containing the new suggestion: {"status": "RESCHEDULE", "suggestion": "The user suggested a new time: ${transcribedText}"}
    - If the response is unclear, off-topic, or just noise, respond with a JSON object like: {"status": "UNCLEAR"}
    
    Return ONLY the JSON object.`;
};

async function getAppointmentRef(appointmentId) {
    const snapshot = await db.collectionGroup('appointments').where('__name__', '==', appointmentId).limit(1).get();
    if (snapshot.empty) {
        throw new Error(`Could not find appointment ${appointmentId}`);
    }
    return snapshot.docs[0].ref;
}

export async function initiateAppointmentFlow(appointmentId) {
    if (!appointmentId) throw new Error('Appointment ID is missing.');

    const appointmentRef = await getAppointmentRef(appointmentId);
    const appointment = (await appointmentRef.get()).data();
    
    const twiml = new twilio.twiml.VoiceResponse();

    twiml.say({ voice: 'alice' }, "Hello, this is Aiva, an automated assistant from Aiva.");
    twiml.pause({ length: 1 });
    twiml.say({ voice: 'alice' }, `I'm calling on behalf of ${appointment.patientName} to book an appointment regarding ${appointment.reasonForAppointment}.`);
    
    twiml.say({ voice: 'alice' }, `Is this time okay, or do you have another preference? Please speak after the tone.`);
    
    twiml.record({
        action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
        maxLength: 30,
        finishOnKey: '#',
        playBeep: true,
        trim: 'trim-silence'
    });

    twiml.say('We did not receive a response. Goodbye.');
    twiml.hangup();
    
    return twiml;
}

export async function handleAppointmentResponse(appointmentId, recordingUrl) {
    if (!appointmentId || !recordingUrl) throw new Error('Missing appointmentId or recordingUrl.');

    const appointmentDocRef = await getAppointmentRef(appointmentId);

    const audioResponse = await axios({
        method: 'get',
        url: `${recordingUrl}.wav`,
        responseType: 'arraybuffer',
        auth: {
            username: process.env.TWILIO_ACCOUNT_SID,
            password: process.env.TWILIO_AUTH_TOKEN
        }
    });
    const audioBuffer = Buffer.from(audioResponse.data);

    const transcribedText = await generateGeminiAudioTranscription(audioBuffer, 'audio/wav');

    if (!transcribedText) {
        await appointmentDocRef.update({ status: 'failed', failureReason: 'Transcription failed.' });
        return;
    }

    const analysisPrompt = getTranscriptionAnalysisPrompt(transcribedText);
    const analysisResultRaw = await generateGeminiText(analysisPrompt);
    const analysisResult = JSON.parse(analysisResultRaw.replace(/^```json\s*|```\s*$/g, ''));

    switch (analysisResult.status) {
        case 'CONFIRMED':
            await appointmentDocRef.update({
                status: 'completed',
                notes: `Appointment confirmed by voice. Transcription: "${transcribedText}"`
            });
            break;
        case 'RESCHEDULE':
            await appointmentDocRef.update({
                status: 'failed_reschedule',
                notes: analysisResult.suggestion,
                failureReason: `Client suggested a new time. Transcription: "${transcribedText}"`
            });
            break;
        case 'UNCLEAR':
        default:
            await appointmentDocRef.update({
                status: 'failed',
                failureReason: `Response was unclear. Transcription: "${transcribedText}"`
            });
            break;
    }
}

// --- NEW: Function to handle call status updates ---
export async function updateCallStatus(appointmentId, callStatus, answeredBy) {
    if (!appointmentId) return;

    const appointmentDocRef = await getAppointmentRef(appointmentId);
    let failureReason = null;

    // Handle Answering Machine Detection results
    if (answeredBy && answeredBy === 'machine_start') {
        failureReason = 'Call answered by voicemail.';
        console.log(`Voicemail detected for appointment ${appointmentId}.`);
    }

    // Handle final call statuses
    switch (callStatus) {
        case 'busy':
            failureReason = 'The line was busy.';
            break;
        case 'no-answer':
            failureReason = 'The call was not answered.';
            break;
        case 'failed':
            failureReason = 'The call could not be connected.';
            break;
        case 'completed':
            // If the call was completed but we already have a status from transcription, don't overwrite it.
            const currentDoc = await appointmentDocRef.get();
            if (currentDoc.data().status === 'calling') {
                // This means the recording webhook didn't fire or complete.
                await appointmentDocRef.update({ status: 'failed', failureReason: 'Call ended without a clear response.' });
            }
            return; // Exit, as 'completed' is a final state handled by the recording logic.
    }

    if (failureReason) {
        console.log(`Updating appointment ${appointmentId} to failed. Reason: ${failureReason}`);
        await appointmentDocRef.update({ status: 'failed', failureReason: failureReason });
    }
}
