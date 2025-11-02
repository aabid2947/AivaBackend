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

// *** NEW: Helper function to log background database errors ***
/**
 * Logs errors from "fire and forget" database operations without crashing
 * @param {Error} error - The error object
 */
const logDBError = (error) => {
    if (error) {
        console.error(`[ERROR] Background database write failed:`, error.message);
    }
};

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
 * @param {string} text - Text to convert to speech
 * @param {string} appointmentId - Appointment ID for caching
 * @returns {Promise<string>} - URL or reference to audio that can be played by Twilio
 */
async function generateAndCacheSpeech(text, appointmentId) {
    try {
        console.log(`[INFO] Generating ElevenLabs speech for appointment ${appointmentId}`);
        const audioBuffer = await generateSpeech(text, VOICE_IDS.SARAH);
        
        // Store the audio buffer temporarily (you might want to upload to cloud storage for production)
        const audioKey = `${appointmentId}_${Date.now()}`;
        audioBuffers.set(audioKey, audioBuffer);
        
        // In production, upload to S3/Cloud Storage and return public URL
        // For now, we'll use TTS through Twilio as fallback
        console.log(`[INFO] Audio generated and cached with key: ${audioKey}`);
        return null; // Will use Twilio Say as fallback
    } catch (error) {
        console.error(`[ERROR] Failed to generate ElevenLabs speech:`, error.message);
        return null; // Will use Twilio Say as fallback
    }
}

const getSingleAiResponsePrompt = (transcribedText, context, conversationHistory, currentState, timeToConfirmISO = null) => {
    const today = new Date();
    const timeZone = 'EAT (UTC+3)';
    const contextData = context.getContextSummary();
    
    // *** FIX: Format contact number for clear TTS pronunciation ***
    // This turns "+919..." into "plus 9 1 9..."
    const formattedUserContact = contextData.userContact 
        ? contextData.userContact.replace(/\+/g, 'plus ').replace(/(\d)/g, '$1 ').trim() 
        : 'No contact number on file';

    let historyContext = conversationHistory.slice(-7).map(entry => 
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
        // Covers ASKING_TIME, HANDLING_QUESTION, CLARIFYING_TIME
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

// Helper functions for conversation management (Unchanged)
async function getConversationHistory(appointmentId) {
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        return appointment.conversationHistory || [];
    } catch (error) {
        console.log(`[WARNING] Could not get conversation history for ${appointmentId}: ${error.message}`);
        return [];
    }
}

async function addToConversationHistory(appointmentId, speaker, message, metadata = {}) {
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const timestamp = new Date().toISOString();
        const historyEntry = {
            speaker,
            message: message.substring(0, 500),
            timestamp,
            ...metadata
        };
        
        await appointmentRef.update({
            conversationHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
            lastActivity: timestamp
        });
    } catch (error) {
        console.error(`[ERROR] Failed to add conversation history for ${appointmentId}: ${error.message}`);
        throw error; // Throw error so .catch(logDBError) can see it
    }
}

async function updateConversationState(appointmentId, newState, metadata = {}) {
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        await appointmentRef.update({
            conversationState: newState,
            lastStateChange: new Date().toISOString(),
            ...metadata
        });
    } catch (error) {
        console.error(`[ERROR] Failed to update conversation state for ${appointmentId}: ${error.message}`);
        throw error; // Throw error so .catch(logDBError) can see it
    }
}

async function getAppointmentRef(appointmentId) {
    try {
        const snapshot = await db.collectionGroup('appointments').get();
        const foundDoc = snapshot.docs.find(doc => doc.id === appointmentId);
        
        if (!foundDoc) {
            console.error(`[ERROR] getAppointmentRef: Could not find appointment ${appointmentId}.`);
            throw new Error(`Could not find appointment ${appointmentId}`);
        }
        return foundDoc.ref;
    } catch (error)
    {
        console.error(`[ERROR] getAppointmentRef: Database error for ${appointmentId}: ${error.message}`);
        throw error;
    }
}

// *** This is the function you are asking for ***
// It sends the confirmation push notification, just like your reminderService.
async function sendAppointmentBookingNotification(appointment, confirmedTime, appointmentId) { // *** FIX: Added appointmentId ***
    try {
        if (!appointment.userId) {
            console.warn(`[WARNING] Cannot send notification: appointment missing userId`);
            return false;
        }

        const userRef = db.collection('users').doc(appointment.userId);
        const userDoc = await userRef.get();

        if (!userDoc.exists || !userDoc.data().fcmToken) {
            console.warn(`User ${appointment.userId} does not have an FCM token. Skipping notification.`);
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
            console.warn(`[WARNING] Gemini failed for notification message: ${geminiError.message}`);
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
                appointmentId: appointmentId || '', // *** FIX: Use passed-in appointmentId ***
                userId: appointment.userId || '',
                type: 'appointment_confirmed',
                confirmedTime: confirmedTime
            }
        };

        const response = await admin.messaging().send(message);
        console.log(`[INFO] Successfully sent appointment confirmation notification:`, response);
        return true;

    } catch (error) {
        console.error(`[ERROR] Failed to send appointment booking notification:`, error);
        
        // This error handling is copied from your reminderService
        if (error.code === 'messaging/registration-token-not-registered') {
            console.warn(`FCM token not registered for user ${appointment.userId}. Removing token from user profile.`);
            try {
                await db.collection('users').doc(appointment.userId).set({ fcmToken: null }, { merge: true });
                console.log(`Removed invalid Fcm token for user ${appointment.userId}`);
            } catch (removeError) {
                console.error(`Failed to remove invalid Fcm token for user ${appointment.userId}:`, removeError);
            }
        }
        
        return false;
    }
}

// Safe JSON parsing (Unchanged)
function safeJsonParse(jsonString, context = '') {
    try {
        const cleanedJson = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
        return JSON.parse(cleanedJson);
    } catch (error) {
        console.error(`[ERROR] JSON parsing failed in ${context}:`, error.message);
        console.error(`[ERROR] Raw response:`, jsonString);
        
        return {
            responseText: "I'm sorry, I had a brief issue. Could you say that again?",
            nextState: CONVERSATION_STATES.CLARIFYING_TIME,
            extractedTimeISO: null,
            analysisSummary: "JSON parse error"
        };
    }
}

// *** UPDATED: initiateAppointmentFlow ***
export async function initiateAppointmentFlow(appointmentId) {
    console.log(`[INFO] initiateAppointmentFlow: Starting for appointmentId: ${appointmentId}`);
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        
        // Create conversation context
        const context = new ConversationContext(appointment);
        conversationContexts.set(appointmentId, context);
        
        // *** FIX: This first update IS critical to clear history, so we 'await' it. ***
        await appointmentRef.update({ 
            retries: 0,
            conversationState: CONVERSATION_STATES.INITIAL_GREETING,
            conversationHistory: [],
            callStartTime: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        });

        // Generate a dynamic, personalized greeting
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
            // *** This is the first main 'await' (Gemini) ***
            greeting = await generateGeminiText(greetingPrompt);
        } catch (error) {
            // Updated fallback greeting to match the new context
            greeting = `Hi! This is Sarah from Aiva Health. I'm calling on behalf of ${context.userName} regarding ${context.reason}. I was wondering, what time would work best for you?`;
        }

        // *** FIX: "Fire and Forget" logging. We don't 'await' these. ***
        addToConversationHistory(appointmentId, 'assistant', greeting).catch(logDBError);
        updateConversationState(appointmentId, CONVERSATION_STATES.ASKING_TIME).catch(logDBError);

        // Try to generate ElevenLabs audio for better quality
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
        
        // Use ElevenLabs audio if available, otherwise use Twilio TTS
        if (audioUrl) {
            gather.play(audioUrl);
        } else {
            gather.say({ voice: 'Polly.Joanna', rate: '95%' }, greeting);
        }

        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] initiateAppointmentFlow: Failed for ${appointmentId}. Error: ${error.message}`, error.stack);
        
        try {
            // *** FIX: Log failure without 'await' ***
            addToConversationHistory(appointmentId, 'system', `Call initialization failed: ${error.message}`, { error: true }).catch(logDBError);
            updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { failureReason: `Initialization error: ${error.message}` }).catch(logDBError);
        } catch (logError) {
            console.error(`[ERROR] Could not log initialization failure: ${logError.message}`);
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

// *** UPDATED: handleAppointmentResponse ***
export async function handleAppointmentResponse(appointmentId, transcribedText, timedOut) {
    console.log(`[INFO] handleAppointmentResponse: Starting for ${appointmentId}`);
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        const conversationHistory = await getConversationHistory(appointmentId);
        let currentState = appointment.conversationState || CONVERSATION_STATES.ASKING_TIME;
        const context = conversationContexts.get(appointmentId) || new ConversationContext(appointment);

        // Handle timeout
        if (timedOut) {
            // *** FIX: "Fire and Forget" logging ***
            addToConversationHistory(appointmentId, 'system', 'User did not respond (timeout)', { timeout: true }).catch(logDBError);
            return await handleTimeout(appointmentId, appointment, twiml, 'general');
        }

        // Validate transcription
        if (!transcribedText || transcribedText.trim().length === 0) {
            // *** FIX: "Fire and Forget" logging ***
            addToConversationHistory(appointmentId, 'user', '[no audio detected]', { silent: true }).catch(logDBError);
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

        // Log user response
        // *** FIX: "Fire and Forget" logging ***
        addToConversationHistory(appointmentId, 'user', transcribedText).catch(logDBError);


        if (currentState === CONVERSATION_STATES.CONFIRMING_TIME) {
            currentState = CONVERSATION_STATES.ASKING_TIME;
        }

        const aiPrompt = getSingleAiResponsePrompt(
            transcribedText, 
            context,
            conversationHistory,
            currentState
        );

        // *** This is now the MAIN pause the user will feel (Gemini) ***
        let aiResponseRaw;
        try {
            aiResponseRaw = await generateGeminiText(aiPrompt);
        } catch (geminiError) {
            console.error(`[ERROR] Gemini single-call failed:`, geminiError.message);
            aiResponseRaw = JSON.stringify({
                responseText: "I'm sorry, I'm having a little trouble. What time were you thinking?",
                nextState: "clarifying_time", // <--Ensure lowercase
                extractedTimeISO: null,
                analysisSummary: "Gemini API error"
            });
        }

        const aiResult = safeJsonParse(aiResponseRaw, 'handleAppointmentResponse');
        console.log(`[INFO] AI Result for ${appointmentId}:`, aiResult);

        // *** FIX: Normalize the nextState to lowercase to match CONVERSATION_STATES object ***
        const nextState = (aiResult.nextState || 'clarifying_time').toLowerCase();

        // Log AI response and analysis
        // *** FIX: "Fire and Forget" logging ***
        addToConversationHistory(appointmentId, 'assistant', aiResult.responseText, { 
            aiAnalysis: aiResult.analysisSummary,
            nextState: nextState
        }).catch(logDBError);

        // Update context based on AI
        if (nextState === CONVERSATION_STATES.ASKING_TIME) {
            context.addRejectedTime(transcribedText); 
        }

        // --- ACT ON AI RESPONSE ---
        
        // Update state in Firestore
        // *** FIX: "Fire and Forget" state update ***
        updateConversationState(appointmentId, nextState, { // <-- Use normalized state
            lastAnalysis: aiResult.analysisSummary,
            suggestedTime: aiResult.extractedTimeISO 
        }).catch(logDBError);

        // Handle the next step based on the state AI determined
        switch (nextState) { // <-- Use normalized state
            
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
                // This state should be handled by handleConfirmationResponse, but as a fallback:
                const audioCompleted = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                if (audioCompleted) {
                    twiml.play(audioCompleted);
                } else {
                    twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                twiml.hangup();
                break;

            case CONVERSATION_STATES.FAILED:
                const audioFailed = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                if (audioFailed) {
                    twiml.play(audioFailed);
                } else {
                    twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                twiml.hangup();
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
        console.error(`[ERROR] handleAppointmentResponse: Critical error for ${appointmentId}:`, error.message, error.stack);
        await handleCriticalError(appointmentId, error, twiml); // *** Keep await here ***
        return twiml;
    }
}

// *** UPDATED: handleConfirmationResponse ***
export async function handleConfirmationResponse(appointmentId, transcribedText, timeToConfirmISO, timedOut) {
    console.log(`[INFO] handleConfirmationResponse: Starting for ${appointmentId}`);
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        const conversationHistory = await getConversationHistory(appointmentId);
        const context = conversationContexts.get(appointmentId) || new ConversationContext(appointment);

        if (timedOut) {
            // *** FIX: "Fire and Forget" logging ***
            addToConversationHistory(appointmentId, 'system', 'Confirmation timeout', { timeout: true }).catch(logDBError);
            return await handleTimeout(appointmentId, appointment, twiml, 'confirmation', timeToConfirmISO);
        }

        if (!transcribedText || transcribedText.trim().length === 0) {
            // *** FIX: "Fire and Forget" logging ***
            addToConversationHistory(appointmentId, 'user', '[no audio in confirmation]', { silent: true }).catch(logDBError);
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

        // *** FIX: "Fire and Forget" logging ***
        addToConversationHistory(appointmentId, 'user', transcribedText, { confirmationResponse: true }).catch(logDBError);

        const aiPrompt = getSingleAiResponsePrompt(
            transcribedText, 
            context,
            conversationHistory,
            CONVERSATION_STATES.CONFIRMING_TIME, 
            timeToConfirmISO
        );

        // *** This is the MAIN pause (Gemini) ***
        let aiResponseRaw;
        try {
            aiResponseRaw = await generateGeminiText(aiPrompt);
        } catch (geminiError) {
            console.error(`[ERROR] Gemini confirmation-call failed:`, geminiError.message);
            aiResponseRaw = JSON.stringify({
                responseText: "I'm sorry, I had a brief issue. Could you confirm that time again?",
                nextState: "confirming_time", // <-- Ensure lowercase
                extractedTimeISO: timeToConfirmISO,
                analysisSummary: "Gemini API error"
            });
        }
        
        const aiResult = safeJsonParse(aiResponseRaw, 'handleConfirmationResponse');
        console.log(`[INFO] AI Confirmation Result for ${appointmentId}:`, aiResult);

        // *** FIX: Normalize the nextState to lowercase to match CONVERSATION_STATES object ***
        const nextState = (aiResult.nextState || 'confirming_time').toLowerCase();

        // Log AI response
        // *** FIX: "Fire and Forget" logging ***
        addToConversationHistory(appointmentId, 'assistant', aiResult.responseText, { 
            aiAnalysis: aiResult.analysisSummary,
            nextState: nextState
        }).catch(logDBError);
        
        // --- ACT ON AI RESPONSE ---
        
        // Update state in Firestore
        // *** FIX: Only "Fire and Forget" update if NOT completed ***
        if (nextState !== CONVERSATION_STATES.COMPLETED) {
            updateConversationState(appointmentId, nextState, { // <-- Use normalized state
                lastAnalysis: aiResult.analysisSummary
            }).catch(logDBError);
        }


        switch (nextState) { // <-- Use normalized state

            case CONVERSATION_STATES.COMPLETED:
                // SUCCESS! AI confirmed the time.
                const audioSuccess = await generateAndCacheSpeech(aiResult.responseText, appointmentId);
                if (audioSuccess) {
                    twiml.play(audioSuccess);
                } else {
                    twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, aiResult.responseText);
                }
                twiml.hangup();
                
                // *** CRITICAL: We MUST 'await' these final writes. ***
                // This ensures the appointment is confirmed before the function ends.
                // The user is hearing the goodbye, so this delay is acceptable.
                await updateConversationState(appointmentId, CONVERSATION_STATES.COMPLETED, {
                    finalAppointmentTime: timeToConfirmISO,
                    confirmedAt: new Date().toISOString()
                });
                
                // *** CRITICAL: We 'await' this to ensure notification is sent. ***
                await sendAppointmentBookingNotification(appointment, timeToConfirmISO, appointmentId);
                break;
            
            case CONVERSATION_STATES.ASKING_TIME:
            case CONVERSATION_STATES.HANDLING_QUESTION:
            case CONVERSATION_STATES.CLARIFYING_TIME:
                // AI detected a "no" or a new question. Send them back to the main loop.
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
                // AI was unclear. Ask for confirmation again.
                const clarificationAttempts = (appointment.confirmationClarifications || 0) + 1;
                
                // *** FIX: "Fire and Forget" this update ***
                getAppointmentRef(appointmentId)
                    .then(ref => ref.update({ confirmationClarifications: clarificationAttempts }))
                    .catch(logDBError);

                if (clarificationAttempts >= 2) {
                    const escalateMessage = "I'm having trouble understanding. Let me have someone call you back to finalize this. Thanks!";
                    const audioEscalate = await generateAndCacheSpeech(escalateMessage, appointmentId);
                    if (audioEscalate) {
                        twiml.play(audioEscalate);
                    } else {
                        twiml.say({ voice: 'Polly.Joanna', rate: '95%' }, escalateMessage);
                    }
                    twiml.hangup();
                    
                    // *** CRITICAL: 'await' this final failure state ***
                    await updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { 
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
        console.error(`[ERROR] handleConfirmationResponse: Critical error for ${appointmentId}:`, error.message);
        await handleCriticalError(appointmentId, error, twiml); // *** Keep await here ***
        return twiml;
    }
}

// *** UPDATED: Centralized Error/Timeout Handlers ***
async function handleTimeout(appointmentId, appointment, twiml, context, timeToConfirmISO = null) {
    let retries;
    let maxRetries;
    let stateToUpdate;
    let gatherActionUrl;
    let retryMessage;

    if (context === 'confirmation') {
        retries = (appointment.confirmationRetries || 0) + 1;
        maxRetries = 2;
        stateToUpdate = 'confirmationRetries';
        gatherActionUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
        const formattedTime = new Date(timeToConfirmISO).toLocaleString('en-US', { timeStyle: 'short', dateStyle: 'medium' });
        retryMessage = `Sorry, I didn't hear anything. Just to confirm, did ${formattedTime} work for you?`;
    } else { // 'general'
        retries = (appointment.retries || 0) + 1;
        maxRetries = MAX_RETRIES;
        stateToUpdate = 'retries';
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
        
        // *** CRITICAL: 'await' this final failure state ***
        await updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { 
            failureReason: `Multiple timeouts (${context})`,
            finalRetries: retries 
        });
    } else {
        // *** FIX: "Fire and Forget" the retry count update ***
        getAppointmentRef(appointmentId)
            .then(ref => ref.update({ [stateToUpdate]: retries }))
            .catch(logDBError);
            
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
    try {
        // *** CRITICAL: 'await' this to ensure error is logged ***
        await addToConversationHistory(appointmentId, 'system', `Critical error: ${error.message}`, { error: true, critical: true });
    } catch (logError) {
        console.error(`[ERROR] Could not log critical error: ${logError.message}`);
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

// *** UNCHANGED: updateCallStatus ***
// This function is called by Twilio's status webhook, not during the live
// TwiML exchange. Its latency does not impact the user, so 'await' is fine.
export async function updateCallStatus(appointmentId, callStatus, answeredBy) {
    if (!appointmentId) return;
    
    console.log(`[INFO] updateCallStatus: ${appointmentId} - Status: ${callStatus}, AnsweredBy: ${answeredBy}`);
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const currentDoc = await appointmentRef.get();
        
        if (!currentDoc.exists) {
            console.error(`[ERROR] updateCallStatus: Appointment ${appointmentId} not found`);
            return;
        }
        
        const appointment = currentDoc.data();
        const currentState = appointment.conversationState;
        let updatePayload = { lastCallStatus: callStatus };

        // Handle different call statuses
        if (answeredBy && answeredBy === 'machine_start') {
            updatePayload = { 
                ...updatePayload,
                status: 'failed', 
                failureReason: 'Call answered by voicemail/answering machine.',
                conversationState: CONVERSATION_STATES.FAILED
            };
            await addToConversationHistory(appointmentId, 'system', 'Call answered by voicemail', { voicemail: true });
            
        } else if (callStatus === 'busy') {
            updatePayload = { 
                ...updatePayload,
                status: 'failed', 
                failureReason: 'Phone line was busy.',
                conversationState: CONVERSATION_STATES.FAILED
            };
            await addToConversationHistory(appointmentId, 'system', 'Phone line busy', { busy: true });
            
        } else if (callStatus === 'no-answer') {
            updatePayload = { 
                ...updatePayload,
                status: 'failed', 
                failureReason: 'No one answered the phone.',
                conversationState: CONVERSATION_STATES.FAILED
            };
            await addToConversationHistory(appointmentId, 'system', 'No answer', { noAnswer: true });
            
        } else if (callStatus === 'failed') {
            updatePayload = { 
                ...updatePayload,
                status: 'failed', 
                failureReason: 'Call failed to connect.',
                conversationState: CONVERSATION_STATES.FAILED
            };
            await addToConversationHistory(appointmentId, 'system', 'Call failed to connect', { callFailed: true });
            
        } else if (callStatus === 'completed') {
            // Only mark as failed if not already completed
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
                    await addToConversationHistory(appointmentId, 'system', 'Call ended unexpectedly', { unexpectedEnd: true });
                }
            }
            
        } else if (callStatus === 'in-progress') {
            updatePayload = { 
                ...updatePayload,
                // conversationState: CONVERSATION_STATES.INITIAL_GREETING, // This is set in initiateFlow
                callInProgress: true,
                callAnsweredAt: new Date().toISOString()
            };
            await addToConversationHistory(appointmentId, 'system', 'Call answered and in progress', { callAnswered: true });
        }
        
        // Update if we have meaningful changes
        if (Object.keys(updatePayload).length > 1) {
            console.log(`[INFO] updateCallStatus: Updating appointment ${appointmentId}:`, updatePayload);
            await appointmentRef.update(updatePayload);
        } else {
            await appointmentRef.update({ lastCallStatus: callStatus });
        }
        
    } catch (error) {
        console.error(`[ERROR] updateCallStatus: Could not update status for ${appointmentId}. Error: ${error.message}`);
        
        try {
            await addToConversationHistory(appointmentId, 'system', `Call status update failed: ${error.message}`, { 
                error: true, 
                callStatus, 
                answeredBy 
            });
        } catch (logError) {
            console.error(`[ERROR] Could not log call status error: ${logError.message}`);
        }
    }
}