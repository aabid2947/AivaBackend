// src/services/twilioCallService.js
import twilio from 'twilio';
import { db, admin } from '../config/firebaseAdmin.js'; 
import { generateGeminiText } from '../utils/geminiClient.js';
import { 
    getAppointmentTimeSuggestionAnalysisPrompt, 
    getConfirmationAnalysisPrompt,
    getFollowUpQuestionAnswerPrompt 
} from './aiva/prompts.js';


async function sendAppointmentConfirmationNotification(userId, appointment) {
    try {
        const userRef = db.collection('users').doc(userId);
        const userDoc = await userRef.get();
        if (!userDoc.exists || !userDoc.data().fcmToken) {
            console.warn(`[FCM] User ${userId} does not have an FCM token. Skipping appointment confirmation notification.`);
            return;
        }
        const fcmToken = userDoc.data().fcmToken;

        const confirmedTime = appointment.finalAppointmentTime.toDate().toLocaleString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true
        });

        let notificationBody = `Confirmed for ${confirmedTime} with ${appointment.userName}.`;
        
        if (appointment.extraDetails && appointment.extraDetails.trim() !== "") {
            notificationBody += `\nNote for call: "${appointment.extraDetails.trim()}"`;
        }


        const message = {
            notification: {
                title: 'Appointment Confirmed!',
                body: notificationBody,
            },
            token: fcmToken,
            data: {
                type: 'APPOINTMENT_CONFIRMED',
                appointmentId: appointment.id,
            }
        };

        await admin.messaging().send(message);
        console.log(`[FCM] Successfully sent appointment confirmation notification to user ${userId}.`);

    } catch (error) {
        console.error(`[FCM] Failed to send FCM notification for user ${userId}:`, error);
    }
}


async function getAppointmentRef(appointmentId) {
    console.log(`[INFO] getAppointmentRef: Searching collection group 'appointments' for document with ID: ${appointmentId}`);
    
    // Get all documents from the 'appointments' collection group.
    const snapshot = await db.collectionGroup('appointments').get();
    
    // Find the specific document by its ID from the results.
    const foundDoc = snapshot.docs.find(doc => doc.id === appointmentId);
    
    if (!foundDoc) {
        console.error(`[ERROR] getAppointmentRef: Could not find appointment ${appointmentId} in any 'appointments' subcollection.`);
        throw new Error(`Could not find appointment ${appointmentId}`);
    }
    
    console.log(`[INFO] getAppointmentRef: Successfully found appointment at path: ${foundDoc.ref.path}`);
    return foundDoc.ref;
}
export async function initiateAppointmentFlow(appointmentId) {
    console.log(`[INFO] initiateAppointmentFlow: Starting for appointmentId: ${appointmentId}`);
    const twiml = new twilio.twiml.VoiceResponse();
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        await appointmentRef.update({ retries: 0 });

        const initialGreeting = `Hello, this is an automated assistant from Aiva, calling on behalf of ${appointment.userName} to schedule an appointment regarding ${appointment.reasonForAppointment}.`;
        const firstQuestion = "What time would be best for the appointment?";

        const gather = twiml.gather({
            input: 'speech',
            action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations',
        });
        gather.say({ voice: 'alice' }, initialGreeting);
        gather.say({ voice: 'alice' }, firstQuestion);

        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] initiateAppointmentFlow: Failed for ${appointmentId}. Error: ${error.message}`);
        twiml.say("Sorry, a configuration error occurred. Goodbye.");
        twiml.hangup();
        return twiml;
    }
}

export async function handleAppointmentResponse(appointmentId, transcribedText, timedOut) {
    console.log(`[INFO] handleAppointmentResponse: Starting for appointmentId: ${appointmentId}`);
    const twiml = new twilio.twiml.VoiceResponse();
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();

        if (timedOut) {
            twiml.say("I didn't hear anything. I will try to call back later. Goodbye.");
            twiml.hangup();
            await appointmentRef.update({ status: 'failed', failureReason: 'Call timed out without a response.' });
            return twiml;
        }

        const analysisPrompt = getAppointmentTimeSuggestionAnalysisPrompt(transcribedText, appointment.userName, appointment.reasonForAppointment);
        const analysisResultRaw = await generateGeminiText(analysisPrompt);
        const analysisResult = JSON.parse(analysisResultRaw.replace(/^```json\s*|```\s*$/g, ''));
        console.log(`[INFO] handleAppointmentResponse: Gemini analysis status: ${analysisResult.status}`);

        switch (analysisResult.status) {
            case 'TIME_SUGGESTED':
                const suggestedTime = new Date(analysisResult.suggested_iso_string);
                const formattedTime = suggestedTime.toLocaleString('en-US', { weekday: 'long', hour: 'numeric', minute: 'numeric', hour12: true });
                const confirmationQuestion = `Okay, just to confirm, that is for ${formattedTime}. Is that correct?`;
                
                const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(analysisResult.suggested_iso_string)}`;
                
                const gatherConfirm = twiml.gather({ input: 'speech', action: confirmationUrl, speechTimeout: 'auto' });
                gatherConfirm.say(confirmationQuestion);
                twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
                break;

            case 'CANNOT_SCHEDULE':
                 twiml.say("Okay, thank you for letting me know. I will relay this information. Goodbye.");
                 twiml.hangup();
                 await appointmentRef.update({ status: 'failed', failureReason: `Client cannot schedule. Reason: "${analysisResult.reason}"` });
                 break;

            case 'QUESTION':
                const answerPrompt = `You are a helpful AI assistant scheduling an appointment. Answer the user's question concisely, then ask again "What time would be best for the appointment?".

                Appointment Details:
                - Patient Name: ${appointment.userName}
                - Reason for Call: ${appointment.reasonForAppointment}
                - Patient Contact Number: ${appointment.userContact || 'Not provided'}
                - Special Instructions: ${appointment.extraDetails || 'None'}

                User's Question: "${analysisResult.question}"
                
                Your concise answer:`;
                
                const answerText = await generateGeminiText(answerPrompt);
                const gatherQuestion = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
                gatherQuestion.say(answerText);
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                break;
            
            case 'AMBIGUOUS':
            case 'UNCLEAR':
            default:
                const retries = (appointment.retries || 0) + 1;
                await appointmentRef.update({ retries: retries });

                if (retries >= 3) {
                    twiml.say("I seem to be having trouble understanding. A human will contact you shortly to finalize the appointment. Goodbye.");
                    twiml.hangup();
                    await appointmentRef.update({ status: 'failed', failureReason: `Response was repeatedly unclear after multiple attempts. Last transcription: "${transcribedText}"` });
                } else if (retries === 2) { 
                    const gatherLastTry = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
                    gatherLastTry.say("My apologies, I'm still not able to understand. Let's try one last time. Could you please state the full date and time you would like for the appointment?");
                    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                } else {
                    const gatherFirstRetry = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
                    gatherFirstRetry.say("I'm sorry, I didn't quite understand. Could you please repeat the date and time for the appointment?");
                    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                }
                break;
        }
        return twiml;
    } catch (error) {
        console.error(`[ERROR] handleAppointmentResponse: Error for ${appointmentId}: ${error.message}`, error.stack);
        twiml.say("Sorry, an internal error occurred. Goodbye.");
        twiml.hangup();
        return twiml;
    }
}

export async function handleConfirmationResponse(appointmentId, transcribedText, timeToConfirmISO, timedOut) {
    const twiml = new twilio.twiml.VoiceResponse();
    const appointmentRef = await getAppointmentRef(appointmentId);
    const appointmentData = (await appointmentRef.get()).data();

    if (timedOut) {
        twiml.say("I didn't get a confirmation. I will try back later. Goodbye.");
        twiml.hangup();
        await appointmentRef.update({ status: 'failed', failureReason: 'Call timed out on final confirmation.' });
        return twiml;
    }
    
    const analysisRaw = await generateGeminiText(getConfirmationAnalysisPrompt(transcribedText));
    const analysis = JSON.parse(analysisRaw.replace(/^```json\s*|```\s*$/g, ''));
    
    switch (analysis.confirmation_status) {
        case 'AFFIRMATIVE':
            const finalAppointmentTime = new Date(timeToConfirmISO);
            await appointmentRef.update({ 
                status: 'completed', 
                finalAppointmentTime: finalAppointmentTime,
                notes: `Appointment confirmed for ${finalAppointmentTime.toLocaleString()}. Transcription: "${transcribedText}"` 
            });

            const updatedAppointmentDoc = await appointmentRef.get();
            const fullAppointmentData = { id: updatedAppointmentDoc.id, ...updatedAppointmentDoc.data() };
            await sendAppointmentConfirmationNotification(fullAppointmentData.userId, fullAppointmentData);

            if (analysis.follow_up_question) {
                // If there's a question, answer it before hanging up.
                const answerToFollowUp = await generateGeminiText(getFollowUpQuestionAnswerPrompt(appointmentData, analysis.follow_up_question));
                twiml.say(`Great! Your appointment is confirmed. Regarding your question: ${answerToFollowUp}. You will receive a confirmation message shortly. Goodbye.`);
            } else {
                // Otherwise, just confirm and hang up.
                twiml.say("Great! Your appointment is confirmed. You will receive a confirmation message shortly. Goodbye.");
            }
            twiml.hangup();
            break;

        case 'NEGATIVE':
            const gatherRetry = twiml.gather({ input: 'speech', action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, speechTimeout: 'auto' });
            gatherRetry.say("My apologies for the mistake. Let's try again. What time would be best for the appointment?");
            twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
            break;

        case 'UNCLEAR':
        default:
            const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
            const gatherUnclear = twiml.gather({ input: 'speech', action: confirmationUrl, speechTimeout: 'auto' });
            gatherUnclear.say("I'm sorry, I didn't catch that. To confirm the appointment time, please say 'yes' or 'no'.");
            twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
            break;
    }
    return twiml;
}


export async function updateCallStatus(appointmentId, callStatus, answeredBy) {
    if (!appointmentId) return;
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        let updatePayload = {};

        if (answeredBy && answeredBy === 'machine_start') {
            updatePayload = { status: 'failed', failureReason: 'Call answered by voicemail.' };
        } else if (callStatus === 'busy' || callStatus === 'no-answer' || callStatus === 'failed') {
            updatePayload = { status: 'failed', failureReason: `Call ${callStatus}.` };
        } else if (callStatus === 'completed') {
            const currentDoc = await appointmentRef.get();
            if (currentDoc.exists && currentDoc.data().status === 'calling') {
                updatePayload = { status: 'failed', failureReason: 'Call ended without a clear resolution.' };
            }
        }
        
        if (Object.keys(updatePayload).length > 0) {
            console.log(`Updating appointment ${appointmentId}. Status: ${updatePayload.status}. Reason: ${updatePayload.failureReason}`);
            await appointmentRef.update(updatePayload);
        }
    } catch (error) {
         console.error(`[ERROR] updateCallStatus: Could not update status for ${appointmentId}. Reason: ${error.message}`);
    }
}