// src/services/twilioCallService.js
import twilio from 'twilio';
import { db } from '../config/firebaseAdmin.js';
import { generateGeminiAudioTranscription, generateGeminiText } from '../utils/geminiClient.js';
import axios from 'axios';

// --- UPDATED: A smarter prompt for Gemini to better understand the user ---
const getTranscriptionAnalysisPrompt = (transcribedText, appointmentDetails) => {
    return `You are an intelligent appointment booking assistant. Analyze the user's response to a proposed appointment.
    Appointment details: The user "${appointmentDetails.userName}" has a proposed appointment for "${appointmentDetails.reasonForAppointment}" at "${appointmentDetails.scheduleTime}".
    The user's spoken response was: "${transcribedText}"

    Classify the response into one of four categories and return ONLY a JSON object:
    1. "CONFIRMED": The user agrees to the time (e.g., "Yes, that works", "Okay", "Fine").
       JSON: {"status": "CONFIRMED"}
    2. "RESCHEDULE": The user rejects the time or suggests a new one (e.g., "No, can we do tomorrow?", "I'm busy then").
       JSON: {"status": "RESCHEDULE", "suggestion": "${transcribedText}"}
    3. "QUESTION": The user asks for more information before confirming (e.g., "Who is this for?", "Where is it?", "Is this about the math lesson?").
       JSON: {"status": "QUESTION", "question": "${transcribedText}"}
    4. "UNCLEAR": The response is ambiguous, off-topic, or just noise (e.g., "Hello?", "Umm...", "I'm not sure").
       JSON: {"status": "UNCLEAR"}
    
    Return only the JSON object.`;
};

async function getAppointmentRef(appointmentId) {
    console.log(`[INFO] getAppointmentRef: Searching collection group 'appointments' for document with ID: ${appointmentId}`);
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
        await appointmentRef.update({ retries: 0 }); // Reset retry counter
        
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
            action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, // Corrected Action URL
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations',
        });
        gather.say({ voice: 'alice' }, firstQuestion);

        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
        
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
    const twiml = new twilio.twiml.VoiceResponse();

    try {
        const appointmentDocRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentDocRef.get()).data();

        if (timedOut) {
            console.log(`[INFO] handleAppointmentResponse: Call timed out.`);
            twiml.say("I didn't hear anything. I will try to call back later. Goodbye.");
            twiml.hangup();
            await appointmentDocRef.update({ status: 'failed', failureReason: 'Call timed out without a response.' });
            return twiml;
        }

        if (!transcribedText) {
            console.warn(`[WARN] handleAppointmentResponse: Transcription was empty.`);
            // This will now be handled by the 'UNCLEAR' logic
            transcribedText = "Response was empty.";
        }

        const formattedTime = appointment.scheduleTime.toDate().toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: true });
        const analysisPrompt = getTranscriptionAnalysisPrompt(transcribedText, {
            userName: appointment.userName,
            reasonForAppointment: appointment.reasonForAppointment,
            scheduleTime: formattedTime,
        });

        const analysisResultRaw = await generateGeminiText(analysisPrompt);
        let analysisResult = JSON.parse(analysisResultRaw.replace(/^```json\s*|```\s*$/g, ''));
        console.log(`[INFO] handleAppointmentResponse: Gemini analysis status: ${analysisResult.status}`);

        switch (analysisResult.status) {
            case 'CONFIRMED':
                twiml.say("Great! Your appointment is confirmed. You will receive a confirmation message shortly. Goodbye.");
                twiml.hangup();
                await appointmentDocRef.update({ status: 'completed', notes: `Appointment confirmed. Transcription: "${transcribedText}"` });
                break;
            
            case 'QUESTION':
                const answerPrompt = `A user is asking a question about their appointment.
                Appointment Details:
                - For: ${appointment.userName}
                - Reason: ${appointment.reasonForAppointment}
                - Proposed Time: ${formattedTime}
                
                User's Question: "${analysisResult.question}"

                Please provide a concise, helpful answer. After answering, you MUST ask again if the originally proposed time is acceptable. Your entire response will be spoken to the user.`;

                const answerText = await generateGeminiText(answerPrompt);
                await appointmentDocRef.update({ notes: `User asked: "${transcribedText}"` });

                const gatherQuestion = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
                gatherQuestion.say(answerText);
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                break;

            case 'RESCHEDULE':
                const reschedulePrompt = `The user wants to reschedule. Their response was: "${analysisResult.suggestion}". Propose a new, specific time (e.g., "tomorrow at 3 PM") and ask if that works.`;
                const nextQuestion = await generateGeminiText(reschedulePrompt);
                
                await appointmentDocRef.update({ notes: `User wants to reschedule: "${transcribedText}"`, lastSuggestion: nextQuestion });
                
                const gatherReschedule = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
                gatherReschedule.say(nextQuestion);
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                break;

            case 'UNCLEAR':
            default:
                const retries = (appointment.retries || 0) + 1;
                if (retries > 1) {
                    twiml.say("I'm still having trouble understanding. A human will contact you shortly to finalize the appointment. Goodbye.");
                    twiml.hangup();
                    await appointmentDocRef.update({ status: 'failed', failureReason: `Response was repeatedly unclear. Last transcription: "${transcribedText}"` });
                } else {
                    await appointmentDocRef.update({ retries: retries });
                    const clarificationQuestion = "I'm sorry, I didn't quite catch that. Can you please say 'yes' to confirm the proposed time, or suggest a different time if you'd like to reschedule?";
                    const gatherUnclear = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
                    gatherUnclear.say(clarificationQuestion);
                    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                }
                break;
        }
        return twiml;
    } catch (error) {
        console.error(`[ERROR] handleAppointmentResponse: An unexpected error occurred for appointmentId: ${appointmentId}. Error: ${error.message}`);
        console.error(error.stack);
        const twimlError = new twilio.twiml.VoiceResponse();
        twimlError.say("Sorry, an internal error occurred. Goodbye.");
        twimlError.hangup();
        return twimlError;
    }
}

export async function updateCallStatus(appointmentId, callStatus, answeredBy) {
    if (!appointmentId) return;

    try {
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
                if (currentDoc.exists && currentDoc.data().status === 'calling') {
                    await appointmentDocRef.update({ status: 'failed', failureReason: 'Call ended without a clear response.' });
                }
                return;
        }

        if (failureReason) {
            console.log(`Updating appointment ${appointmentId} to failed. Reason: ${failureReason}`);
            await appointmentDocRef.update({ status: 'failed', failureReason: failureReason });
        }
    } catch (error) {
         console.error(`[ERROR] updateCallStatus: Could not update status for ${appointmentId}. Reason: ${error.message}`);
    }
}