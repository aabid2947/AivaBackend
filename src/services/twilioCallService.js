// src/services/twilioCallService.js
import twilio from 'twilio';
import { db, admin } from '../config/firebaseAdmin.js';
import { generateGeminiText } from '../utils/geminiClient.js';
import { generateSpeech, VOICE_IDS } from '../utils/elevenLabsClient.js';

// Conversation states to track the flow
const CONVERSATION_STATES = {
    INITIAL_GREETING: 'initial_greeting',
    ASKING_TIME: 'asking_time',
    CLARIFYING_TIME: 'clarifying_time', 
    CONFIRMING_TIME: 'confirming_time',
    HANDLING_QUESTION: 'handling_question',
    COMPLETED: 'completed',
    FAILED: 'failed'
};

// Configuration constants
const MAX_RETRIES = 3;

// Enhanced conversation context tracker
class ConversationContext {
    constructor(appointment) {
        this.appointment = appointment;
        this.userName = appointment.userName ? appointment.userName.replace(/^(Dr\.?\s*)/i, '').trim() : 'the patient';
        this.userContact = appointment.userContact || null; 
        this.reason = appointment.reasonForAppointment || 'medical consultation';
        this.extraDetails = appointment.extraDetails || '';
        this.conversationTone = 'friendly_professional';
        this.suggestedTimes = [];
        this.rejectedTimes = [];
        this.questionsAsked = [];
        this.userPreferences = {};
        this.extractedInfo = {};
        this.conversationMood = 'neutral';
        this.topicsDiscussed = [];
        this.conversationHistory = []; // In-memory conversation history
        this.currentState = CONVERSATION_STATES.INITIAL_GREETING;
        this.retries = 0;
        this.confirmationRetries = 0;
        this.confirmationClarifications = 0;
    }
    
    addSuggestedTime(time) {
        this.suggestedTimes.push(time);
    }
    
    addRejectedTime(time) {
        this.rejectedTimes.push(time);
    }
    
    addQuestion(question, type) {
        this.questionsAsked.push({ question, type, timestamp: new Date().toISOString() });
    }
    
    setUserPreference(key, value) {
        this.userPreferences[key] = value;
    }
    
    updateExtractedInfo(key, value) {
        this.extractedInfo[key] = value;
    }
    
    setConversationMood(mood) {
        this.conversationMood = mood;
    }
    
    addTopicDiscussed(topic) {
        if (!this.topicsDiscussed.includes(topic)) {
            this.topicsDiscussed.push(topic);
        }
    }
    
    addToHistory(speaker, message, metadata = {}) {
        this.conversationHistory.push({
            speaker,
            message: message.substring(0, 500),
            timestamp: new Date().toISOString(),
            ...metadata
        });
    }
    
    getContextSummary() {
        return {
            userName: this.userName,
            userContact: this.userContact, 
            reason: this.reason,
            extraDetails: this.extraDetails,
            suggestedTimes: this.suggestedTimes,
            rejectedTimes: this.rejectedTimes,
            questionsAsked: this.questionsAsked,
            userPreferences: this.userPreferences,
            extractedInfo: this.extractedInfo,
            conversationMood: this.conversationMood,
            topicsDiscussed: this.topicsDiscussed
        };
    }
}

// Store conversation contexts
const conversationContexts = new Map();

// Store audio buffers temporarily
const audioBuffers = new Map();

/**
 * Helper function to generate speech using ElevenLabs and prepare it for Twilio
 */
async function generateAndCacheSpeech(text, appointmentId) {
    try {
        const audioBuffer = await generateSpeech(text, VOICE_IDS.SARAH);
        const audioKey = `${appointmentId}_${Date.now()}`;
        audioBuffers.set(audioKey, audioBuffer);
        return null;
    } catch (error) {
        return null;
    }
}

const getSingleAiResponsePrompt = (transcribedText, context, currentState, timeToConfirmISO = null) => {
    const today = new Date();
    const timeZone = 'EAT (UTC+3)';
    const contextData = context.getContextSummary();
    
    const formattedUserContact = contextData.userContact 
        ? contextData.userContact.replace(/\+/g, 'plus ').replace(/(\d)/g, '$1 ').trim() 
        : 'No contact number on file';

    let historyContext = context.conversationHistory.slice(-7).map(entry => 
        `${entry.speaker}: "${entry.message}"`
    ).join('\n');

    let taskInstruction = '';
    
    if (currentState === CONVERSATION_STATES.CONFIRMING_TIME) {
        const formattedTime = new Date(timeToConfirmISO).toLocaleString('en-US', { 
            weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: 'numeric', hour12: true 
        });
        taskInstruction = `
        Task: You just asked the provider (the person you are calling) to confirm an appointment for ${formattedTime}.
        The provider replied: "${transcribedText}"

        Analyze their reply and decide the next step:
        1.  **CONFIRMING**: (e.g., "yes", "that works", "perfect").
        2.  **DECLINING**: (e.g., "no", "I can't", "need a different time").
        3.  **UNCLEAR/QUESTION**: (e.g., "what?", "how much?", "maybe", or garbled audio).
        `;
    } else {
        taskInstruction = `
        Task: You are in a phone call to schedule an appointment with a provider.
        The provider just said: "${transcribedText}"

        Analyze their reply and decide the next step:
        1.  **TIME_REFERENCE**: Provider suggested a time (e.g., "tomorrow at 2", "next Monday morning").
        2.  **QUESTION_CLIENT_INFO**: Provider is asking for the *client's* info (e.g., "What's his number?", "What's ${contextData.userName}'s contact?").
        3.  **QUESTION_GENERAL**: General question (e.g., "how much?", "how long is the session?").
        4.  **SOCIAL/UNCLEAR**: Provider is making small talk, or the audio is garbled/nonsensical.
        `;
    }

    return `You are an intelligent AI appointment scheduler named Sarah from Aiva Health. Your goal is to book an appointment with the person you are calling (the provider), *on behalf of* a client.

CRITICAL CONTEXT:
- Today: ${today.toDateString()}
- Timezone: ${timeZone}
    
- You are scheduling FOR (Client): ${contextData.userName}
- Client's Contact Number: ${formattedUserContact} 
- Purpose of Appointment: ${contextData.reason}
    
- Conversation state: ${currentState}
- Rejected times: ${contextData.rejectedTimes.join(', ') || 'None'}
- Conversation History:
${historyContext}

${taskInstruction}

Based on your analysis, generate a natural, conversational response and determine the next logical state.
    
*** IMPORTANT RULES ***
1.  **Handle Contact Info**:
    - If the user (the provider you are calling) asks for the *client's* contact information (e.g., "What is ${contextData.userName}'s number?"), **you must provide the 'Client's Contact Number'** from the \`CRITICAL_CONTEXT\`.
    - When you say the number, say it exactly as written (with spaces) so the Text-to-Speech can read it clearly.
    - Example response: "Sure, his contact number is ${formattedUserContact}."
    - **Do NOT** provide Aiva Health's contact info, as per instructions.
2.  **Main Task**:
    - If they gave a specific time, generate a confirmation question (e.g., "Great, just to confirm, that's [parsed time]?").
    - If they confirmed a time, generate a final success message (e.g., "Wonderful! The appointment is confirmed...").
    - If they declined a time, ask for a new time (e.g., "No problem! What time works better?").
    - If they asked a question, answer it (using Rule 1 if applicable) and then *gently guide back to scheduling*.
    - If unclear, ask for clarification.
3.  **Be Conversational**: Always sound like a warm, real person named Sarah, not a bot.

Return a single, valid JSON object with this *exact* structure. Do NOT add markdown or any text outside the JSON.
{
  "responseText": "The natural, conversational text to say to the user.",
  "nextState": "asking_time | confirming_time | handling_question | completed | failed | clarifying_time", 
  "extractedTimeISO": "YYYY-MM-DDTHH:mm:ss+03:00 or null if no specific time was extracted/confirmed",
  "analysisSummary": "A brief, one-sentence summary of the user's intent."
}
`;
}

async function getAppointmentRef(appointmentId) {
    const snapshot = await db.collectionGroup('appointments').get();
    const foundDoc = snapshot.docs.find(doc => doc.id === appointmentId);
    
    if (!foundDoc) {
        throw new Error(`Could not find appointment ${appointmentId}`);
    }
    return foundDoc.ref;
}

async function sendAppointmentBookingNotification(appointment, confirmedTime, appointmentId) {
    try {
        if (!appointment.userId) {
            return false;
        }

        const userRef = db.collection('users').doc(appointment.userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists || !userDoc.data().fcmToken) {
            return false;
        }

        const fcmToken = userDoc.data().fcmToken;
        const cleanUserName = appointment.userName ? appointment.userName.replace(/^(Dr\.?\s*)/i, '').trim() : 'the patient';
        
        const prompt = `Create a warm, brief appointment confirmation message (under 50 words):
- Patient: ${cleanUserName}
- Appointment: ${appointment.reasonForAppointment || 'medical consultation'}
- Time: ${new Date(confirmedTime).toLocaleString('en-US', { 
    weekday: 'long', 
    month: 'long',
    day: 'numeric',
    hour: 'numeric', 
    minute: 'numeric', 
    hour12: true 
})}

Make it friendly and reassuring.`;

        let notificationBody;
        try {
            notificationBody = await generateGeminiText(prompt);
        } catch (geminiError) {
            notificationBody = `Your appointment for ${cleanUserName} is confirmed for ${new Date(confirmedTime).toLocaleString('en-US', { 
                weekday: 'long', 
                month: 'short',
                day: 'numeric',
                hour: 'numeric', 
                minute: 'numeric', 
                hour12: true 
            })}.`;
        }

        const message = {
            notification: {
                title: '✅ Appointment Confirmed',
                body: notificationBody.trim(),
            },
            token: fcmToken,
            data: {
                appointmentId: appointmentId || '',
                userId: appointment.userId || '',
                type: 'appointment_confirmed',
                confirmedTime: confirmedTime
            }
        };

        const response = await admin.messaging().send(message);
        return true;

    } catch (error) {
        if (error.code === 'messaging/registration-token-not-registered') {
            try {
                await db.collection('users').doc(appointment.userId).set({ fcmToken: null }, { merge: true });
            } catch (removeError) {
                // Silent fail
            }
        }
        
        return false;
    }
}

function safeJsonParse(jsonString, context = '') {
    try {
        const cleanedJson = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
        return JSON.parse(cleanedJson);
    } catch (error) {
        return {
            responseText: "I'm sorry, I had a brief issue. Could you say that again?",
            nextState: CONVERSATION_STATES.CLARIFYING_TIME,
            extractedTimeISO: null,
            analysisSummary: "JSON parse error"
        };
    }
}

async function saveFinalConversationData(appointmentId, context) {
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        await appointmentRef.update({
            conversationHistory: context.conversationHistory,
            conversationState: context.currentState,
            retries: context.retries,
            confirmationRetries: context.confirmationRetries,
            confirmationClarifications: context.confirmationClarifications,
            lastActivity: new Date().toISOString(),
            callEndTime: new Date().toISOString()
        });
    } catch (error) {
        // Silent fail
    }
}

export async function initiateAppointmentFlow(appointmentId) {
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        
        const context = new ConversationContext(appointment);
        conversationContexts.set(appointmentId, context);
        
        await appointmentRef.update({ 
            retries: 0,
            conversationState: CONVERSATION_STATES.INITIAL_GREETING,
            conversationHistory: [],
            callStartTime: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        });

        const greetingPrompt = `You are an AI assistant named Sarah from Aiva Health. Generate a warm, natural phone greeting.

Context:
- You are calling *on behalf of* a client: ${context.userName}
- The purpose is: ${context.reason}
${context.extraDetails ? `- Additional info: ${context.extraDetails}` : ''}

Create a friendly greeting that:
1. Clearly states your name (Sarah) and that you are calling *on behalf of* ${context.userName}.
2. Clearly states the reason for the call ("${context.reason}").
3. Asks about their availability to schedule this.
4. Is under 45 words and conversational.

Example: "Hi there, this is Sarah from Aiva Health. I'm calling on behalf of ${context.userName} to book an appointment for tutoring. Do you have a moment to find a time that works?"`;

        let greeting;
        try {
            greeting = await generateGeminiText(greetingPrompt);
        } catch (error) {
            greeting = `Hi! This is Sarah from Aiva Health. I'm calling on behalf of ${context.userName} regarding ${context.reason}. I was wondering, what time would work best for you?`;
        }

        context.addToHistory('assistant', greeting);
        context.currentState = CONVERSATION_STATES.ASKING_TIME;

        const audioUrl = await generateAndCacheSpeech(greeting, appointmentId);
        
        const gather = twiml.gather({
            input: 'speech',
            action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations',
            language: 'en-US',
            enhanced: true,
            speechTimeout: 4,
            hints: 'tomorrow, next week, Monday, Tuesday, Wednesday, Thursday, Friday, morning, afternoon, evening'
        });
        
        if (audioUrl) {
            gather.play(audioUrl);
        } else {
            gather.say({ voice: 'Polly.Joanna', rate: '95%' }, greeting);
        }

        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
        
        return twiml;
    } catch (error) {
        try {
            const context = conversationContexts.get(appointmentId);
            if (context) {
                context.addToHistory('system', `Call initialization failed: ${error.message}`, { error: true });
                context.currentState = CONVERSATION_STATES.FAILED;
                await saveFinalConversationData(appointmentId, context);
            }
        } catch (logError) {
            // Silent fail
        }
        
        const initErrorMessage = "Oh, I'm having a technical issue on my end. Someone from our team will call you back shortly. Sorry about that!";
        const audioInitError = await generateAndCacheSpeech(initErrorMessage, appointmentId);
        if (audioInitError) {
            twiml.play(audioInitError);
        } else {
            twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, initErrorMessage);
        }
        twiml.hangup();
        return twiml;
    }
}

export async function handleAppointmentResponse(appointmentId, transcribedText, timedOut) {
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        const context = conversationContexts.get(appointmentId) || new ConversationContext(appointment);

        if (timedOut) {
            context.addToHistory('system', 'User did not respond (timeout)', { timeout: true });
            return await handleTimeout(appointmentId, context, twiml, 'general');
        }

        if (!transcribedText || transcribedText.trim().length === 0) {
            context.addToHistory('user', '[no audio detected]', { silent: true });
            const clarificationMessage = "I couldn't quite hear that. Could you tell me when you'd like to schedule?";
            const audioUrl = await generateAndCacheSpeech(clarificationMessage, appointmentId);
            
            const gather = twiml.gather({
                input: 'speech',
                action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
                speechTimeout: 'auto',
                speechModel: 'experimental_conversations'
            });
            
            if (audioUrl) {
                gather.play(audioUrl);
            } else {
                gather.say({ voice: 'Polly.Joanna', rate: '95%' }, clarificationMessage);
            }
            
            twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
            return twiml;
        }

        context.addToHistory('user', transcribedText);

        let currentState = context.currentState;
        if (currentState === CONVERSATION_STATES.CONFIRMING_TIME) {
            currentState = CONVERSATION_STATES.ASKING_TIME;
        }

        const aiPrompt = getSingleAiResponsePrompt(transcribedText, context, currentState);

        let aiResponseRaw;
        try {
            aiResponseRaw = await generateGeminiText(aiPrompt);
        } catch (geminiError) {
            aiResponseRaw = JSON.stringify({
                responseText: "I'm sorry, I'm having a little trouble. What time were you thinking?",
                nextState: "clarifying_time",
                extractedTimeISO: null,
                analysisSummary: "Gemini API error"
            });
        }

        const aiResult = safeJsonParse(aiResponseRaw, 'handleAppointmentResponse');
        const nextState = (aiResult.nextState || 'clarifying_time').toLowerCase();

        context.addToHistory('assistant', aiResult.responseText, { 
            aiAnalysis: aiResult.analysisSummary,
            nextState: nextState
        });

        if (nextState === CONVERSATION_STATES.ASKING_TIME) {
            context.addRejectedTime(transcribedText); 
        }

        context.currentState = nextState;

        switch (nextState) {
            
            case CONVERSATION_STATES.CONFIRMING_TIME:
                const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(aiResult.extractedTimeISO)}`;
                const audioConfirm = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                
                const gatherConfirm = twiml.gather({ 
                    input: 'speech', 
                    action: confirmationUrl, 
                    speechTimeout: 'auto',
                    speechModel: 'experimental_conversations'
                });
                
                if (audioConfirm) {
                    gatherConfirm.play(audioConfirm);
                } else {
                    gatherConfirm.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                
                twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
                break;

            case CONVERSATION_STATES.COMPLETED:
                const audioCompleted = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                if (audioCompleted) {
                    twiml.play(audioCompleted);
                } else {
                    twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                twiml.hangup();
                await saveFinalConversationData(appointmentId, context);
                break;

            case CONVERSATION_STATES.FAILED:
                const audioFailed = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                if (audioFailed) {
                    twiml.play(audioFailed);
                } else {
                    twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                twiml.hangup();
                await saveFinalConversationData(appointmentId, context);
                break;

            case CONVERSATION_STATES.ASKING_TIME:
            case CONVERSATION_STATES.CLARIFYING_TIME:
            case CONVERSATION_STATES.HANDLING_QUESTION:
            default:
                const audioContinue = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                const gather = twiml.gather({
                    input: 'speech',
                    action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
                    speechTimeout: 'auto',
                    speechModel: 'experimental_conversations'
                });
                
                if (audioContinue) {
                    gather.play(audioContinue);
                } else {
                    gather.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                break;
        }

        return twiml;

    } catch (error) {
        await handleCriticalError(appointmentId, error, twiml);
        return twiml;
    }
}

// *** UPDATED: handleConfirmationResponse ***
export async function handleConfirmationResponse(appointmentId, transcribedText, timeToConfirmISO, timedOut) {
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        const context = conversationContexts.get(appointmentId) || new ConversationContext(appointment);

        if (timedOut) {
            context.addToHistory('system', 'Confirmation timeout', { timeout: true });
            return await handleTimeout(appointmentId, context, twiml, 'confirmation', timeToConfirmISO);
        }

        if (!transcribedText || transcribedText.trim().length === 0) {
            context.addToHistory('user', '[no audio in confirmation]', { silent: true });
            const formattedTime = new Date(timeToConfirmISO).toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' });
            const clarifyMessage = `I didn't catch that. For ${formattedTime}, is that a yes?`;
            const audioClarify = await generateAndCacheSpeech(clarifyMessage, appointmentId);
            const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
            
            const gatherClarify = twiml.gather({ input: 'speech', action: confirmationUrl, speechTimeout: 'auto' });
            if (audioClarify) {
                gatherClarify.play(audioClarify);
            } else {
                gatherClarify.say({ voice: 'Polly.Joanna', rate: '95%' }, clarifyMessage);
            }
            
            twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
            return twiml;
        }

        context.addToHistory('user', transcribedText, { confirmationResponse: true });

        const aiPrompt = getSingleAiResponsePrompt(transcribedText, context, CONVERSATION_STATES.CONFIRMING_TIME, timeToConfirmISO);

        let aiResponseRaw;
        try {
            aiResponseRaw = await generateGeminiText(aiPrompt);
        } catch (geminiError) {
            aiResponseRaw = JSON.stringify({
                responseText: "I'm sorry, I had a brief issue. Could you confirm that time again?",
                nextState: "confirming_time",
                extractedTimeISO: timeToConfirmISO,
                analysisSummary: "Gemini API error"
            });
        }
        
        const aiResult = safeJsonParse(aiResponseRaw, 'handleConfirmationResponse');
        const nextState = (aiResult.nextState || 'confirming_time').toLowerCase();

        context.addToHistory('assistant', aiResult.responseText, { 
            aiAnalysis: aiResult.analysisSummary,
            nextState: nextState
        });
        
        context.currentState = nextState;

        switch (nextState) {

            case CONVERSATION_STATES.COMPLETED:
                const audioSuccess = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                if (audioSuccess) {
                    twiml.play(audioSuccess);
                } else {
                    twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                twiml.hangup();
                
                await appointmentRef.update({
                    conversationState: CONVERSATION_STATES.COMPLETED,
                    finalAppointmentTime: timeToConfirmISO,
                    confirmedAt: new Date().toISOString()
                });
                
                await saveFinalConversationData(appointmentId, context);
                await sendAppointmentBookingNotification(appointment, timeToConfirmISO, appointmentId);
                break;
            
            case CONVERSATION_STATES.ASKING_TIME:
            case CONVERSATION_STATES.HANDLING_QUESTION:
            case CONVERSATION_STATES.CLARIFYING_TIME:
                context.addRejectedTime(new Date(timeToConfirmISO).toLocaleString());
                const audioRetry = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                
                const gatherRetry = twiml.gather({ 
                    input: 'speech', 
                    action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
                    speechTimeout: 'auto'
                });
                
                if (audioRetry) {
                    gatherRetry.play(audioRetry);
                } else {
                    gatherRetry.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                break;
                
            case CONVERSATION_STATES.CONFIRMING_TIME:
            default:
                context.confirmationClarifications++;

                if (context.confirmationClarifications >= 2) {
                    const escalateMessage = "I'm having trouble understanding. Let me have someone call you back to finalize this. Thanks!";
                    const audioEscalate = await generateAndCacheSpeech(escalateMessage, appointmentId);
                    if (audioEscalate) {
                        twiml.play(audioEscalate);
                    } else {
                        twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, escalateMessage);
                    }
                    twiml.hangup();
                    
                    context.currentState = CONVERSATION_STATES.FAILED;
                    await saveFinalConversationData(appointmentId, context);
                    await appointmentRef.update({
                        conversationState: CONVERSATION_STATES.FAILED,
                        failureReason: 'Unable to get clear confirmation',
                        suggestedTime: timeToConfirmISO
                    });
                } else {
                    const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
                    const audioUnclear = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                    const gatherUnclear = twiml.gather({ input: 'speech', action: confirmationUrl, speechTimeout: 'auto' });
                    if (audioUnclear) {
                        gatherUnclear.play(audioUnclear);
                    } else {
                        gatherUnclear.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                    }
                    twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
                }
                break;
        }
        
        return twiml;
    } catch (error) {
        await handleCriticalError(appointmentId, error, twiml);
        return twiml;
    }
}

async function handleTimeout(appointmentId, context, twiml, timeoutType, timeToConfirmISO = null) {
    let retries;
    let maxRetries;
    let gatherActionUrl;
    let retryMessage;

    if (timeoutType === 'confirmation') {
        retries = context.confirmationRetries + 1;
        context.confirmationRetries = retries;
        maxRetries = 2;
        gatherActionUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
        const formattedTime = new Date(timeToConfirmISO).toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' });
        retryMessage = `Sorry, I didn't hear anything. Just to confirm, did ${formattedTime} work for you?`;
    } else {
        retries = context.retries + 1;
        context.retries = retries;
        maxRetries = MAX_RETRIES;
        gatherActionUrl = `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`;
        retryMessage = "Sorry, I didn't catch that. When would be a good time for you?";
    }

    if (retries >= maxRetries) {
        const failMessage = "I'm having trouble hearing you. Let me have someone call you back to help with this. Have a great day!";
        const audioFail = await generateAndCacheSpeech(failMessage, appointmentId);
        if (audioFail) {
            twiml.play(audioFail);
        } else {
            twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, failMessage);
        }
        twiml.hangup();
        
        context.currentState = CONVERSATION_STATES.FAILED;
        await saveFinalConversationData(appointmentId, context);
        
        const appointmentRef = await getAppointmentRef(appointmentId);
        await appointmentRef.update({
            conversationState: CONVERSATION_STATES.FAILED,
            failureReason: `Multiple timeouts (${timeoutType})`,
            finalRetries: retries
        });
    } else {
        const audioRetry = await generateAndCacheSpeech(retryMessage, appointmentId);
        const gather = twiml.gather({
            input: 'speech',
            action: gatherActionUrl,
            speechTimeout: 'auto'
        });
        if (audioRetry) {
            gather.play(audioRetry);
        } else {
            gather.say({ voice: 'Polly.Joanna', rate: '95%' }, retryMessage);
        }
        twiml.redirect({ method: 'POST' }, gatherActionUrl + '&timedOut=true');
    }
    return twiml;
}

async function handleCriticalError(appointmentId, error, twiml) {
    const context = conversationContexts.get(appointmentId);
    if (context) {
        context.addToHistory('system', `Critical error: ${error.message}`, { error: true, critical: true });
        context.currentState = CONVERSATION_STATES.FAILED;
        await saveFinalConversationData(appointmentId, context);
    }
    
    const errorMessage = "I'm so sorry, I'm having technical difficulties. Someone from our team will call you back very soon. Thank you for your patience!";
    const audioError = await generateAndCacheSpeech(errorMessage, appointmentId);
    if (audioError) {
        twiml.play(audioError);
    } else {
        twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, errorMessage);
    }
    twiml.hangup();
}

export async function updateCallStatus(appointmentId, callStatus, answeredBy) {
    if (!appointmentId) return;
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const currentDoc = await appointmentRef.get();
        
        if (!currentDoc.exists) {
            return;
        }
        
        const appointment = currentDoc.data();
        const currentState = appointment.conversationState;
        const context = conversationContexts.get(appointmentId);
        
        let updatePayload = {};
        if (callStatus && callStatus !== 'undefined') {
            updatePayload.lastCallStatus = callStatus;
        }

        if (answeredBy && answeredBy === 'machine_start') {
            updatePayload = { 
                ...updatePayload,
                status: 'failed', 
                failureReason: 'Call answered by voicemail/answering machine.',
                conversationState: CONVERSATION_STATES.FAILED
            };
            if (context) {
                context.addToHistory('system', 'Call answered by voicemail', { voicemail: true });
                await saveFinalConversationData(appointmentId, context);
            }
            
        } else if (answeredBy === 'human' && !callStatus) {
            updatePayload = { 
                ...updatePayload,
                callAnsweredAt: new Date().toISOString(),
                callInProgress: true
            };
            if (context) {
                context.addToHistory('system', 'Call answered by human - streaming active', { 
                    answered: true, 
                    streaming: true 
                });
            }
            
        } else if (callStatus === 'busy') {
            updatePayload = { 
                ...updatePayload,
                status: 'failed', 
                failureReason: 'Phone line was busy.',
                conversationState: CONVERSATION_STATES.FAILED
            };
            if (context) {
                context.addToHistory('system', 'Phone line busy', { busy: true });
                await saveFinalConversationData(appointmentId, context);
            }
            
        } else if (callStatus === 'no-answer') {
            updatePayload = { 
                ...updatePayload,
                status: 'failed', 
                failureReason: 'No one answered the phone.',
                conversationState: CONVERSATION_STATES.FAILED
            };
            if (context) {
                context.addToHistory('system', 'No answer', { noAnswer: true });
                await saveFinalConversationData(appointmentId, context);
            }
            
        } else if (callStatus === 'failed') {
            updatePayload = { 
                ...updatePayload,
                status: 'failed', 
                failureReason: 'Call failed to connect.',
                conversationState: CONVERSATION_STATES.FAILED
            };
            if (context) {
                context.addToHistory('system', 'Call failed to connect', { callFailed: true });
                await saveFinalConversationData(appointmentId, context);
            }
            
        } else if (callStatus === 'completed') {
            if (currentState !== CONVERSATION_STATES.COMPLETED) {
                if (currentState === CONVERSATION_STATES.CALLING || 
                    currentState === CONVERSATION_STATES.INITIAL_GREETING ||
                    currentState === CONVERSATION_STATES.ASKING_TIME) {
                    
                    updatePayload = { 
                        ...updatePayload,
                        status: 'failed', 
                        failureReason: 'Call ended without completing appointment.',
                        conversationState: CONVERSATION_STATES.FAILED
                    };
                    if (context) {
                        context.addToHistory('system', 'Call ended unexpectedly', { unexpectedEnd: true });
                        await saveFinalConversationData(appointmentId, context);
                    }
                }
            } else if (context) {
                await saveFinalConversationData(appointmentId, context);
            }
            
        } else if (callStatus === 'in-progress') {
            updatePayload = { 
                ...updatePayload,
                callInProgress: true,
                callAnsweredAt: new Date().toISOString()
            };
            if (context) {
                context.addToHistory('system', 'Call answered and in progress', { callAnswered: true });
            }
        }
        
        if (Object.keys(updatePayload).length > 0) {
            await appointmentRef.update(updatePayload);
        } else if (callStatus && callStatus !== 'undefined') {
            await appointmentRef.update({ lastCallStatus: callStatus });
        }
        
    } catch (error) {
        // Silent fail
    }
}