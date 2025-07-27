// src/services/twilioCallService.js
import twilio from 'twilio';
import { db } from '../config/firebaseAdmin.js';
import { generateGeminiAudioTranscription, generateGeminiText } from '../utils/geminiClient.js';
import axios from 'axios';

const getTranscriptionAnalysisPrompt = (transcribedText, currentSuggestion) => {
    return `You are an AI assistant helping to book an appointment.
    The user was asked about a proposed appointment time: "${currentSuggestion}".
    Their spoken response was: "${transcribedText}"

    Analyze this response and classify it into one of three categories: "CONFIRMED", "RESCHEDULE", or "UNCLEAR".
    - If the user agrees (e.g., "yes", "that's fine", "okay"), respond with a JSON object: {"status": "CONFIRMED"}
    - If the user suggests a new time or rejects the current one (e.g., "how about tomorrow at 2pm?", "no, I need something in the evening"), respond with a JSON object: {"status": "RESCHEDULE", "suggestion": "${transcribedText}"}
    - If the response is unclear, off-topic, or just noise, respond with a JSON object: {"status": "UNCLEAR"}
    
    Return ONLY the JSON object.`;
};

async function getAppointmentRef(appointmentId) {
    console.log(`[INFO] getAppointmentRef: Searching collection group 'appointments' for document with ID: ${appointmentId}`);

    // WARNING: This is an inefficient query that scans all documents in the 'appointments'
    // collection group. This is required by the current database structure.
    // FOR BETTER PERFORMANCE: Add the appointment ID as a field within the document and create a
    // Firestore index for that field to allow for a direct query.
    const snapshot = await db.collectionGroup('appointments').get();
    
    const foundDoc = snapshot.docs.find(doc => doc.id === appointmentId);

    if (!foundDoc) {
        console.error(`[ERROR] getAppointmentRef: Could not find appointment ${appointmentId} in any 'appointments' subcollection.`);
        throw new Error(`Could not find appointment ${appointmentId}`);
    }
    
    console.log(`[INFO] getAppointmentRef: Successfully found appointment at path: ${foundDoc.ref.path}`);
    return foundDoc.ref;
}


export async function initiateAppointmentFlow(appointmentId, initialMessage) {
    console.log(`[INFO] initiateAppointmentFlow: Starting for appointmentId: ${appointmentId}`);
    if (!appointmentId) {
        console.error("[ERROR] initiateAppointmentFlow: Appointment ID is missing.");
        throw new Error('Appointment ID is missing.');
    }

    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        
        const twiml = new twilio.twiml.VoiceResponse();

        twiml.say({ voice: 'alice' }, "Hello, this is an automated assistant from Aiva.");
        twiml.pause({ length: 1 });
        
        let firstQuestion;
        
        if (initialMessage) {
            firstQuestion = initialMessage;
        } else {
            const scheduleTime = appointment.scheduleTime.toDate();
            const formattedTime = scheduleTime.toLocaleString('en-US', {
                weekday: 'long',
                hour: 'numeric',
                minute: 'numeric',
                hour12: true
            });
            firstQuestion = `I'm calling on behalf of ${appointment.userName} to book an appointment regarding ${appointment.reasonForAppointment}. The proposed time is ${formattedTime}. Is this okay?`;
        }


        const gather = twiml.gather({
            input: 'speech',
            action: `/api/twilio/twiML/handleResponse?appointmentId=${appointmentId}`,
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations',
        });
        gather.say({ voice: 'alice' }, firstQuestion);

        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleResponse?appointmentId=${appointmentId}&timedOut=true`);
        
        console.log(`[DEBUG] initiateAppointmentFlow: Generated TwiML: ${twiml.toString()}`);
        return twiml;

    } catch (error) {
        console.error(`[ERROR] initiateAppointmentFlow: Failed for appointmentId: ${appointmentId}. Error: ${error.message}`);
        const twiml = new twilio.twiml.VoiceResponse();
        twiml.say("Sorry, an error occurred on our end. Goodbye.");
        twiml.hangup();
        return twiml;
    }
}

export async function handleAppointmentResponse(appointmentId, transcribedText, timedOut) {
    console.log(`[INFO] handleAppointmentResponse: Starting for appointmentId: ${appointmentId}`);
    console.log(`[DEBUG] handleAppointmentResponse: Transcribed Text: "${transcribedText}", Timed Out: ${timedOut}`);

    const twiml = new twilio.twiml.VoiceResponse();

    try {
        const appointmentDocRef = await getAppointmentRef(appointmentId);

        if (timedOut) {
            console.log(`[INFO] handleAppointmentResponse: Call timed out.`);
            twiml.say("I didn't hear anything. I will try to call back later. Goodbye.");
            twiml.hangup();
            await appointmentDocRef.update({ status: 'failed', failureReason: 'Call timed out without a response.' });
            return twiml;
        }

        if (!transcribedText) {
            console.warn(`[WARN] handleAppointmentResponse: Transcription was empty.`);
            twiml.say("I'm having trouble understanding. Let's try that again.");
            twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/appointmentCall?appointmentId=${appointmentId}`);
            return twiml;
        }

        const appointment = (await appointmentDocRef.get()).data();
        const analysisPrompt = getTranscriptionAnalysisPrompt(transcribedText, appointment.lastSuggestion || `The proposed time`);
        console.log(`[DEBUG] handleAppointmentResponse: Sending prompt to Gemini for analysis: ${analysisPrompt}`);

        const analysisResultRaw = await generateGeminiText(analysisPrompt);
        console.log(`[DEBUG] handleAppointmentResponse: Raw analysis from Gemini: ${analysisResultRaw}`);

        let analysisResult;
        try {
            if (!analysisResultRaw) throw new Error("Gemini returned null or empty response.");
            analysisResult = JSON.parse(analysisResultRaw.replace(/^```json\s*|```\s*$/g, ''));
        } catch (e) {
            console.error(`[ERROR] handleAppointmentResponse: Failed to parse JSON from Gemini. Error: ${e.message}. Raw response: "${analysisResultRaw}"`);
            analysisResult = { status: 'UNCLEAR' };
        }

        console.log(`[INFO] handleAppointmentResponse: Gemini analysis status: ${analysisResult.status}`);

        switch (analysisResult.status) {
            case 'CONFIRMED':
                twiml.say("Great! Your appointment is confirmed. You will receive a confirmation message shortly. Goodbye.");
                twiml.hangup();
                await appointmentDocRef.update({ status: 'completed', notes: `Appointment confirmed. Transcription: "${transcribedText}"` });
                break;
            
            case 'RESCHEDULE':
                const reschedulePrompt = `The user wants to reschedule. Their response was: "${analysisResult.suggestion}". Propose a new, specific time (e.g., "tomorrow at 3 PM") and ask if that works.`;
                const nextQuestion = await generateGeminiText(reschedulePrompt);
                
                await appointmentDocRef.update({ notes: `User wants to reschedule: "${analysisResult.suggestion}"`, lastSuggestion: nextQuestion });
                
                const gather = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleResponse?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
                gather.say(nextQuestion);
                twiml.say("Sorry, I didn't catch that.");
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleResponse?appointmentId=${appointmentId}`);
                break;

            case 'UNCLEAR':
            default:
                const clarificationQuestion = "I'm sorry, I didn't understand that. Can you please say whether the proposed time works for you, or suggest another time?";
                const gatherUnclear = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleResponse?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
                gatherUnclear.say(clarificationQuestion);
                twiml.say("I'm still having trouble. A human will contact you to finalize the appointment. Goodbye.");
                twiml.hangup();
                await appointmentDocRef.update({ status: 'failed', failureReason: `Response was unclear. Transcription: "${transcribedText}"` });
                break;
        }

        console.log(`[DEBUG] handleAppointmentResponse: Final TwiML: ${twiml.toString()}`);
        return twiml;

    } catch (error) {
        console.error(`[ERROR] handleAppointmentResponse: An unexpected error occurred for appointmentId: ${appointmentId}. Error: ${error.message}`);
        console.error(error.stack);
        twiml.say("Sorry, an error occurred. Goodbye.");
        twiml.hangup();
        return twiml;
    }
}
export async function updateCallStatus(appointmentId, callStatus, answeredBy) {
    if (!appointmentId) return;

    const appointmentDocRef = await getAppointmentRef(appointmentId);
    let failureReason = null;

    if (answeredBy && answeredBy === 'machine_start') {
        failureReason = 'Call answered by voicemail.';
        console.log(`Voicemail detected for appointment ${appointmentId}.`);
    }

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
            const currentDoc = await appointmentDocRef.get();
            if (currentDoc.data().status === 'calling') {
                await appointmentDocRef.update({ status: 'failed', failureReason: 'Call ended without a clear response.' });
            }
            return;
    }

    if (failureReason) {
        console.log(`Updating appointment ${appointmentId} to failed. Reason: ${failureReason}`);
        await appointmentDocRef.update({ status: 'failed', failureReason: failureReason });
    }
}