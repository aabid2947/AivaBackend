// src/services/twilioCallService.js
import twilio from 'twilio';
import { db, admin } from '../config/firebaseAdmin.js'; 
import { generateGeminiText } from '../utils/geminiClient.js';
import { 
    getAppointmentTimeSuggestionAnalysisPrompt, 
    getConfirmationAnalysisPrompt,
    getFollowUpQuestionAnswerPrompt 
} from './aiva/prompts.js';

// Human-like conversation templates
const HUMAN_RESPONSES = {
    greetings: [
        "Hi there! This is Sarah calling from Aiva on behalf of {userName}.",
        "Hello! I'm calling from Aiva to help schedule an appointment with {userName}.",
        "Hi! Sarah here from Aiva. I'm helping {userName} with scheduling."
    ],
    timeRequest: [
        "I'm calling about scheduling an appointment for {reasonForAppointment}. When would work best for you?",
        "We need to set up an appointment regarding {reasonForAppointment}. What day and time would be convenient?",
        "I'm helping arrange an appointment about {reasonForAppointment}. What's your availability like?"
    ],
    clarifications: [
        "I want to make sure I got that right - you're saying {time}?",
        "Perfect! So that's {time}, correct?",
        "Great! Just to double-check - {time}, right?"
    ],
    retries: [
        "Sorry, I missed that. Could you tell me again what time works for you?",
        "I didn't quite catch that. What day and time would be best?",
        "My apologies, could you repeat the time you'd prefer?"
    ],
    finalRetries: [
        "I'm having trouble understanding. Could you please say the complete date and time slowly? For example, 'Monday at 2 PM'?",
        "Let me try this differently - could you tell me the full date and time, like 'Tuesday, January 15th at 10 AM'?"
    ],
    confirmations: [
        "Excellent! Your appointment is all set. You'll get a confirmation text shortly.",
        "Perfect! All booked. You should receive a confirmation message in just a moment.",
        "Wonderful! That's confirmed. A text confirmation will be coming your way."
    ],
    contextRedirects: [
        "I understand, but let's focus on scheduling your appointment first. What time would work for you?",
        "That's good to know! Right now I need to get your appointment scheduled though. When are you available?",
        "I hear you! For now, let's get this appointment set up. What day and time work best?"
    ]
};

// Enhanced conversation context analyzer
async function analyzeConversationContext(transcribedText, appointmentData) {
    const contextPrompt = `Analyze this user response in the context of appointment scheduling. Determine if it's:
1. TIME_SUGGESTION - User provided a time/date
2. APPOINTMENT_QUESTION - Question directly related to the appointment
3. OFF_TOPIC - Unrelated conversation or small talk
4. UNCLEAR_INTENT - Cannot determine intent
5. CANNOT_SCHEDULE - User cannot or won't schedule

Context: Scheduling appointment for "${appointmentData.reasonForAppointment}" with ${appointmentData.userName}

User said: "${transcribedText}"

Respond with JSON:
{
    "intent": "TIME_SUGGESTION|APPOINTMENT_QUESTION|OFF_TOPIC|UNCLEAR_INTENT|CANNOT_SCHEDULE",
    "confidence": 0.0-1.0,
    "extracted_info": "relevant information if any",
    "suggested_response_type": "how to respond"
}`;

    const analysisRaw = await generateGeminiText(contextPrompt);
    return JSON.parse(analysisRaw.replace(/^```json\s*|```\s*$/g, ''));
}

// Generate human-like responses
function getHumanLikeResponse(type, data = {}) {
    const templates = HUMAN_RESPONSES[type] || [];
    if (templates.length === 0) return "";
    
    const template = templates[Math.floor(Math.random() * templates.length)];
    return template.replace(/\{(\w+)\}/g, (match, key) => data[key] || match);
}

// Enhanced natural language processor for appointments
async function processAppointmentResponse(transcribedText, appointmentData) {
    const enhancedPrompt = `You are an expert at understanding natural appointment scheduling conversations. 

Appointment Context:
- Patient: ${appointmentData.userName}  
- Reason: ${appointmentData.reasonForAppointment}
- Contact: ${appointmentData.userContact || 'Not provided'}

User Response: "${transcribedText}"

Analyze what the user said and respond with JSON:

If they suggested a time/date:
{
    "status": "TIME_SUGGESTED",
    "suggested_iso_string": "2024-MM-DDTHH:MM:SS",
    "confidence": 0.0-1.0,
    "natural_format": "how user said it"
}

If they asked an appointment-related question:
{
    "status": "APPOINTMENT_QUESTION", 
    "question": "their question",
    "question_type": "location|duration|preparation|cost|insurance|other"
}

If they can't schedule:
{
    "status": "CANNOT_SCHEDULE",
    "reason": "why they cannot schedule"
}

If unclear or off-topic:
{
    "status": "UNCLEAR",
    "issue": "what made it unclear",
    "off_topic": true/false
}

Be very flexible with time formats. Users might say "tomorrow at 3", "next Tuesday morning", "around 2pm on the 15th", etc.`;

    const analysisRaw = await generateGeminiText(enhancedPrompt);
    return JSON.parse(analysisRaw.replace(/^```json\s*|```\s*$/g, ''));
}

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
    
    const snapshot = await db.collectionGroup('appointments').get();
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
        await appointmentRef.update({ retries: 0, conversationTurns: 0 });

        // More natural, human-like greeting
        const greeting = getHumanLikeResponse('greetings', { userName: appointment.userName });
        const timeRequest = getHumanLikeResponse('timeRequest', { 
            userName: appointment.userName, 
            reasonForAppointment: appointment.reasonForAppointment 
        });

        const gather = twiml.gather({
            input: 'speech',
            action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations',
            timeout: 15,
            finishOnKey: '#'
        });
        
        gather.say({ voice: 'alice', rate: '0.9' }, greeting);
        gather.pause({ length: 1 });
        gather.say({ voice: 'alice', rate: '0.9' }, timeRequest);

        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] initiateAppointmentFlow: Failed for ${appointmentId}. Error: ${error.message}`);
        twiml.say({ voice: 'alice' }, "I'm sorry, there seems to be a technical issue. Someone will call you back shortly. Have a great day!");
        twiml.hangup();
        return twiml;
    }
}

export async function handleAppointmentResponse(appointmentId, transcribedText, timedOut) {
    console.log(`[INFO] handleAppointmentResponse: Starting for appointmentId: ${appointmentId}, transcription: "${transcribedText}"`);
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        
        // Track conversation turns to prevent infinite loops
        const conversationTurns = (appointment.conversationTurns || 0) + 1;
        await appointmentRef.update({ conversationTurns });

        if (timedOut) {
            const timeoutResponses = [
                "I didn't hear anything there. No worries, I'll try calling back later. Take care!",
                "Seems like we got disconnected. I'll reach out again soon. Have a good day!",
                "I think we lost connection. I'll call back in a bit. Thanks!"
            ];
            const response = timeoutResponses[Math.floor(Math.random() * timeoutResponses.length)];
            twiml.say({ voice: 'alice', rate: '0.9' }, response);
            twiml.hangup();
            await appointmentRef.update({ status: 'failed', failureReason: 'Call timed out without a response.' });
            return twiml;
        }

        // Enhanced analysis with context awareness
        const analysisResult = await processAppointmentResponse(transcribedText, appointment);
        console.log(`[INFO] handleAppointmentResponse: Analysis result:`, analysisResult);

        // Prevent excessive conversation turns
        if (conversationTurns > 8) {
            twiml.say({ voice: 'alice', rate: '0.9' }, "You know what, let me have someone call you back to sort this out properly. They'll be in touch soon. Thanks for your patience!");
            twiml.hangup();
            await appointmentRef.update({ 
                status: 'failed', 
                failureReason: 'Conversation exceeded maximum turns - human handoff required.' 
            });
            return twiml;
        }

        switch (analysisResult.status) {
            case 'TIME_SUGGESTED':
                if (analysisResult.confidence < 0.6) {
                    // Low confidence - ask for clarification naturally
                    const clarifyResponses = [
                        `I want to make sure I understand - did you say ${analysisResult.natural_format || 'that time'}?`,
                        `Just to be clear, you're looking for ${analysisResult.natural_format || 'that time'}?`,
                        `Let me confirm - ${analysisResult.natural_format || 'that time'}, is that right?`
                    ];
                    const clarifyResponse = clarifyResponses[Math.floor(Math.random() * clarifyResponses.length)];
                    
                    const gatherClarify = twiml.gather({ 
                        input: 'speech', 
                        action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
                        speechTimeout: 'auto',
                        timeout: 10 
                    });
                    gatherClarify.say({ voice: 'alice', rate: '0.9' }, clarifyResponse);
                    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                } else {
                    // High confidence - proceed with confirmation
                    const suggestedTime = new Date(analysisResult.suggested_iso_string);
                    const formattedTime = suggestedTime.toLocaleString('en-US', { 
                        weekday: 'long', 
                        month: 'short', 
                        day: 'numeric', 
                        hour: 'numeric', 
                        minute: 'numeric', 
                        hour12: true 
                    });
                    
                    const confirmationQuestion = getHumanLikeResponse('clarifications', { time: formattedTime });
                    const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(analysisResult.suggested_iso_string)}`;
                    
                    const gatherConfirm = twiml.gather({ 
                        input: 'speech', 
                        action: confirmationUrl, 
                        speechTimeout: 'auto',
                        timeout: 10 
                    });
                    gatherConfirm.say({ voice: 'alice', rate: '0.9' }, confirmationQuestion);
                    twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
                }
                break;

            case 'APPOINTMENT_QUESTION':
                // Handle appointment-related questions intelligently
                const questionAnswerPrompt = `You are a helpful medical appointment scheduler. Answer this appointment-related question naturally and briefly, then redirect back to scheduling.

                Appointment Context:
                - Patient: ${appointment.userName}
                - Reason: ${appointment.reasonForAppointment}
                - Contact: ${appointment.userContact || 'Not provided'}
                - Extra details: ${appointment.extraDetails || 'None'}

                Question Type: ${analysisResult.question_type}
                User's Question: "${analysisResult.question}"

                Provide a helpful, conversational answer (1-2 sentences max), then naturally ask about their availability again. Sound like a real person, not robotic.

                Example response format: "That's a great question! [answer]. Now, when would be the best time for your appointment?"`;
                
                const questionAnswer = await generateGeminiText(questionAnswerPrompt);
                const gatherAfterQuestion = twiml.gather({ 
                    input: 'speech', 
                    action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
                    speechTimeout: 'auto',
                    timeout: 15 
                });
                gatherAfterQuestion.say({ voice: 'alice', rate: '0.9' }, questionAnswer);
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                break;

            case 'CANNOT_SCHEDULE':
                const understandingResponses = [
                    "I completely understand. I'll let them know, and someone will follow up with you about other options. Thanks for your time!",
                    "No problem at all. I'll pass that along, and they'll reach out to you. Have a great day!",
                    "That makes sense. I'll make sure they know, and they'll be in touch. Take care!"
                ];
                const understandingResponse = understandingResponses[Math.floor(Math.random() * understandingResponses.length)];
                twiml.say({ voice: 'alice', rate: '0.9' }, understandingResponse);
                twiml.hangup();
                await appointmentRef.update({ 
                    status: 'failed', 
                    failureReason: `Client cannot schedule. Reason: "${analysisResult.reason}"` 
                });
                break;

            case 'UNCLEAR':
            default:
                const retries = (appointment.retries || 0) + 1;
                await appointmentRef.update({ retries });

                if (analysisResult.off_topic) {
                    // Handle off-topic responses with gentle redirection
                    const redirectResponse = getHumanLikeResponse('contextRedirects');
                    const gatherRedirect = twiml.gather({ 
                        input: 'speech', 
                        action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
                        speechTimeout: 'auto',
                        timeout: 15 
                    });
                    gatherRedirect.say({ voice: 'alice', rate: '0.9' }, redirectResponse);
                    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                } else if (retries >= 3) {
                    twiml.say({ voice: 'alice', rate: '0.9' }, "You know what, let me have one of our team members call you directly to get this sorted out. They'll be much better at this than I am! Thanks for being so patient.");
                    twiml.hangup();
                    await appointmentRef.update({ 
                        status: 'failed', 
                        failureReason: `Multiple unclear responses - human handoff required. Last: "${transcribedText}"` 
                    });
                } else if (retries === 2) { 
                    const finalTryResponse = getHumanLikeResponse('finalRetries');
                    const gatherFinal = twiml.gather({ 
                        input: 'speech', 
                        action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
                        speechTimeout: 'auto',
                        timeout: 15 
                    });
                    gatherFinal.say({ voice: 'alice', rate: '0.9' }, finalTryResponse);
                    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                } else {
                    const retryResponse = getHumanLikeResponse('retries');
                    const gatherRetry = twiml.gather({ 
                        input: 'speech', 
                        action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
                        speechTimeout: 'auto',
                        timeout: 15 
                    });
                    gatherRetry.say({ voice: 'alice', rate: '0.9' }, retryResponse);
                    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                }
                break;
        }
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] handleAppointmentResponse: Error for ${appointmentId}: ${error.message}`, error.stack);
        twiml.say({ voice: 'alice', rate: '0.9' }, "I'm sorry, I'm having some technical difficulties. Let me have someone call you back. Thanks!");
        twiml.hangup();
        return twiml;
    }
}

export async function handleConfirmationResponse(appointmentId, transcribedText, timeToConfirmISO, timedOut) {
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointmentData = (await appointmentRef.get()).data();

        if (timedOut) {
            const timeoutResponses = [
                "I didn't hear back from you, so I'll try again later. Talk soon!",
                "Seems like we got cut off. I'll call back shortly. Thanks!",
                "I think we lost you there. I'll reach out again soon!"
            ];
            const response = timeoutResponses[Math.floor(Math.random() * timeoutResponses.length)];
            twiml.say({ voice: 'alice', rate: '0.9' }, response);
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
                    notes: `Appointment confirmed via AI call for ${finalAppointmentTime.toLocaleString()}. User response: "${transcribedText}"` 
                });

                const updatedAppointmentDoc = await appointmentRef.get();
                const fullAppointmentData = { id: updatedAppointmentDoc.id, ...updatedAppointmentDoc.data() };
                await sendAppointmentConfirmationNotification(fullAppointmentData.userId, fullAppointmentData);

                if (analysis.follow_up_question) {
                    const answerToFollowUp = await generateGeminiText(getFollowUpQuestionAnswerPrompt(appointmentData, analysis.follow_up_question));
                    const confirmationResponse = getHumanLikeResponse('confirmations');
                    twiml.say({ voice: 'alice', rate: '0.9' }, `${confirmationResponse} And about your question - ${answerToFollowUp}. Have a great day!`);
                } else {
                    const confirmationResponse = getHumanLikeResponse('confirmations');
                    twiml.say({ voice: 'alice', rate: '0.9' }, `${confirmationResponse} Have a wonderful day!`);
                }
                twiml.hangup();
                break;

            case 'NEGATIVE':
                const retryResponses = [
                    "Oh, my mistake! Let's get that fixed. What time would work better for you?",
                    "Sorry about that! Let me get the right time. When would be good for you?",
                    "Oops, let me correct that. What time did you have in mind?"
                ];
                const retryResponse = retryResponses[Math.floor(Math.random() * retryResponses.length)];
                const gatherRetry = twiml.gather({ 
                    input: 'speech', 
                    action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
                    speechTimeout: 'auto',
                    timeout: 15 
                });
                gatherRetry.say({ voice: 'alice', rate: '0.9' }, retryResponse);
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                break;

            case 'UNCLEAR':
            default:
                const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
                const unclearResponses = [
                    "I didn't quite catch that. Could you just say 'yes' if that time works, or 'no' if it doesn't?",
                    "Sorry, I missed that. Is that time good for you? Just say yes or no.",
                    "I'm not sure I understood. Should I book that time? Please say yes or no."
                ];
                const unclearResponse = unclearResponses[Math.floor(Math.random() * unclearResponses.length)];
                const gatherUnclear = twiml.gather({ 
                    input: 'speech', 
                    action: confirmationUrl, 
                    speechTimeout: 'auto',
                    timeout: 10 
                });
                gatherUnclear.say({ voice: 'alice', rate: '0.9' }, unclearResponse);
                twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
                break;
        }
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] handleConfirmationResponse: Error for ${appointmentId}: ${error.message}`, error.stack);
        twiml.say({ voice: 'alice', rate: '0.9' }, "I'm having some technical trouble. Let me have someone call you back to confirm. Thanks!");
        twiml.hangup();
        return twiml;
    }
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
                updatePayload = { status: 'failed', failureReason: 'Call ended without clear resolution.' };
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