// src/services/twilioCallService.js
import twilio from 'twilio';
import { db } from '../config/firebaseAdmin.js';
import { generateGeminiText } from '../utils/geminiClient.js';

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
const MAX_CLARIFICATION_ATTEMPTS = 2;

// --- Enhanced PROMPT for analyzing open-ended time suggestions with conversation context ---
const getAppointmentTimeSuggestionAnalysisPrompt = (transcribedText, userName, reason, conversationHistory = [], currentState = '') => {
    const today = new Date();
    const timeZone = 'EAT (UTC+3)';
    
    let contextInfo = '';
    if (conversationHistory.length > 0) {
        contextInfo = `\n\nConversation History:`;
        conversationHistory.slice(-3).forEach((entry, index) => {
            contextInfo += `\n${index + 1}. ${entry.speaker}: "${entry.message}"`;
        });
    }

    return `You are an intelligent appointment booking assistant for a healthcare practice. 
    
    CONTEXT:
    - You are calling to schedule an appointment for "${userName}" regarding "${reason}"
    - Today's date: ${today.toDateString()}
    - User timezone: ${timeZone}
    - Current conversation state: ${currentState}
    ${contextInfo}
    
    The user's latest response was: "${transcribedText}"
    
    Analyze this response carefully and return ONLY a JSON object with the following structure:

    1. TIME_SUGGESTED - User provides specific date/time:
       {"status": "TIME_SUGGESTED", "suggested_iso_string": "YYYY-MM-DDTHH:mm:ss+03:00", "confidence": "high|medium|low", "extracted_info": "what the user actually said about time"}

    2. QUESTION - User asks a question:
       {"status": "QUESTION", "question": "${transcribedText}", "question_type": "availability|details|clarification|other"}

    3. CANNOT_SCHEDULE - User indicates they cannot schedule:
       {"status": "CANNOT_SCHEDULE", "reason": "${transcribedText}", "should_retry": true|false}

    4. NEED_MORE_INFO - User needs more details:
       {"status": "NEED_MORE_INFO", "what_they_need": "description of what info they're asking for"}

    5. AMBIGUOUS - Response is vague but not a clear no:
       {"status": "AMBIGUOUS", "interpretation": "your best guess of what they meant", "clarification_needed": "what to ask them"}

    6. UNCLEAR - Complete noise or unintelligible:
       {"status": "UNCLEAR", "transcription_quality": "poor|garbled|silent"}

    IMPORTANT RULES:
    - If they mention any time reference (tomorrow, next week, Monday, 2pm, etc.), classify as TIME_SUGGESTED
    - Be generous with time interpretation - "sometime next week" is still TIME_SUGGESTED with low confidence
    - Consider conversation context - if they previously asked about availability, factor that in
    - For ambiguous responses, provide helpful clarification suggestions

    Return only the JSON object.`;
};

// --- Enhanced PROMPT for final confirmation with context ---
const getAffirmativeNegativeClassificationPrompt = (userReply, suggestedTime, conversationHistory = []) => {
    let contextInfo = '';
    if (conversationHistory.length > 0) {
        contextInfo = `\nRecent conversation:\n${conversationHistory.slice(-2).map(entry => `${entry.speaker}: "${entry.message}"`).join('\n')}`;
    }

    return `The user was asked to confirm an appointment time: "${suggestedTime}".
    Their reply: "${userReply}"
    ${contextInfo}
    
    Classify this response as:
    - "AFFIRMATIVE" - Yes, agreed, confirmed (examples: "yes", "that works", "perfect", "sounds good", "okay")
    - "NEGATIVE" - No, disagree, want different time (examples: "no", "that doesn't work", "can we try different time")
    - "UNCLEAR" - Ambiguous or hard to understand
    
    Consider the tone and context. Return only: AFFIRMATIVE, NEGATIVE, or UNCLEAR`;
};

// --- Helper functions for conversation management ---
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
            message: message.substring(0, 500), // Limit message length
            timestamp,
            ...metadata
        };
        
        await appointmentRef.update({
            conversationHistory: db.FieldValue.arrayUnion(historyEntry),
            lastActivity: timestamp
        });
    } catch (error) {
        console.error(`[ERROR] Failed to add conversation history for ${appointmentId}: ${error.message}`);
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
    }
}

async function getAppointmentRef(appointmentId) {
    try {
        // Query the appointments collection group by document ID field
        const snapshot = await db.collectionGroup('appointments').get();
        const foundDoc = snapshot.docs.find(doc => doc.id === appointmentId);
        
        if (!foundDoc) {
            console.error(`[ERROR] getAppointmentRef: Could not find appointment ${appointmentId}.`);
            throw new Error(`Could not find appointment ${appointmentId}`);
        }
        return foundDoc.ref;
    } catch (error) {
        console.error(`[ERROR] getAppointmentRef: Database error for ${appointmentId}: ${error.message}`);
        throw error;
    }
}

// Enhanced error handling with detailed logging
async function handleGeminiError(error, context, fallbackResponse = null) {
    console.error(`[ERROR] Gemini API failed in ${context}:`, error.message);
    
    if (fallbackResponse) {
        console.log(`[INFO] Using fallback response for ${context}`);
        return fallbackResponse;
    }
    
    // Return a safe default response for parsing
    return JSON.stringify({
        status: "UNCLEAR",
        error: "AI_SERVICE_UNAVAILABLE",
        context: context
    });
}

// Safe JSON parsing with error handling
function safeJsonParse(jsonString, context = '') {
    try {
        // Clean up common Gemini response formatting issues
        const cleanedJson = jsonString.replace(/^```json\s*|```\s*$/g, '').trim();
        return JSON.parse(cleanedJson);
    } catch (error) {
        console.error(`[ERROR] JSON parsing failed in ${context}:`, error.message);
        console.error(`[ERROR] Raw response:`, jsonString);
        
        // Return a safe fallback
        return {
            status: "UNCLEAR",
            error: "JSON_PARSE_ERROR",
            raw_response: jsonString.substring(0, 200)
        };
    }
}

export async function initiateAppointmentFlow(appointmentId) {
    console.log(`[INFO] initiateAppointmentFlow: Starting for appointmentId: ${appointmentId}`);
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        
        // Initialize conversation state and history
        await appointmentRef.update({ 
            retries: 0,
            conversationState: CONVERSATION_STATES.INITIAL_GREETING,
            conversationHistory: [],
            callStartTime: new Date().toISOString(),
            lastActivity: new Date().toISOString()
        });

        // Build personalized greeting
        let initialGreeting = `Hello, this is an automated assistant from Aiva healthcare services, calling on behalf of ${appointment.userName} to schedule an appointment.`;
        
        // Add reason with more context
        if (appointment.reasonForAppointment) {
            initialGreeting += ` The appointment is regarding ${appointment.reasonForAppointment}.`;
        } else {
            initialGreeting += ` The appointment is for a medical consultation.`;
        }
        
        // Add extra details if provided
        if (appointment.extraDetails) {
            initialGreeting += ` I also have this special instruction: ${appointment.extraDetails}.`;
        }
        
        const firstQuestion = "What time would be best for this appointment?";

        // Log the initial conversation
        await addToConversationHistory(appointmentId, 'assistant', initialGreeting + ' ' + firstQuestion);
        await updateConversationState(appointmentId, CONVERSATION_STATES.ASKING_TIME);

        const gather = twiml.gather({
            input: 'speech',
            action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations',
            language: 'en-US',
            enhanced: true,
            speechTimeout: 5
        });
        
        gather.say({ voice: 'alice', rate: 'medium' }, initialGreeting);
        gather.pause({ length: 1 });
        gather.say({ voice: 'alice', rate: 'medium' }, firstQuestion);

        // Fallback for timeout
        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] initiateAppointmentFlow: Failed for ${appointmentId}. Error: ${error.message}`, error.stack);
        
        // Log the error to conversation history if possible
        try {
            await addToConversationHistory(appointmentId, 'system', `Call initialization failed: ${error.message}`, { error: true });
            await updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { failureReason: `Initialization error: ${error.message}` });
        } catch (logError) {
            console.error(`[ERROR] Could not log initialization failure: ${logError.message}`);
        }
        
        twiml.say({ voice: 'alice', rate: 'medium' }, "Sorry, we're experiencing technical difficulties. A representative will contact you shortly to schedule your appointment. Goodbye.");
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
        const conversationHistory = await getConversationHistory(appointmentId);
        const currentState = appointment.conversationState || CONVERSATION_STATES.ASKING_TIME;

        // Handle timeout scenario
        if (timedOut) {
            await addToConversationHistory(appointmentId, 'system', 'User did not respond (timeout)', { timeout: true });
            
            const retries = (appointment.retries || 0) + 1;
            if (retries >= MAX_RETRIES) {
                twiml.say({ voice: 'alice', rate: 'medium' }, "I haven't heard a response. A representative will call you back to schedule the appointment. Goodbye.");
                twiml.hangup();
                await updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { 
                    failureReason: 'Multiple timeouts without response',
                    finalRetries: retries 
                });
            } else {
                await appointmentRef.update({ retries: retries });
                const gather = twiml.gather({
                    input: 'speech',
                    action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
                    speechTimeout: 'auto',
                    speechModel: 'experimental_conversations',
                    enhanced: true
                });
                gather.say({ voice: 'alice', rate: 'medium' }, "I didn't hear anything. Could you please tell me what time would work best for your appointment?");
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
            }
            return twiml;
        }

        // Validate transcription
        if (!transcribedText || transcribedText.trim().length === 0) {
            await addToConversationHistory(appointmentId, 'user', '[no audio detected]', { silent: true });
            const gather = twiml.gather({
                input: 'speech',
                action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
                speechTimeout: 'auto',
                speechModel: 'experimental_conversations'
            });
            gather.say({ voice: 'alice', rate: 'medium' }, "I couldn't hear you clearly. Could you please repeat what time would work best?");
            twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
            return twiml;
        }

        // Log user response
        await addToConversationHistory(appointmentId, 'user', transcribedText);

        // Analyze response with enhanced context
        const analysisPrompt = getAppointmentTimeSuggestionAnalysisPrompt(
            transcribedText, 
            appointment.userName, 
            appointment.reasonForAppointment || 'medical consultation',
            conversationHistory,
            currentState
        );

        let analysisResultRaw;
        try {
            analysisResultRaw = await generateGeminiText(analysisPrompt);
        } catch (geminiError) {
            analysisResultRaw = await handleGeminiError(geminiError, 'appointment response analysis');
        }

        const analysisResult = safeJsonParse(analysisResultRaw, 'appointment response analysis');
        console.log(`[INFO] handleAppointmentResponse: Gemini analysis for ${appointmentId}:`, analysisResult);

        // Handle different response types
        switch (analysisResult.status) {
            case 'TIME_SUGGESTED':
                return await handleTimeSuggestion(appointmentId, analysisResult, twiml, appointment);

            case 'CANNOT_SCHEDULE':
                return await handleCannotSchedule(appointmentId, analysisResult, twiml, appointment);

            case 'QUESTION':
                return await handleUserQuestion(appointmentId, analysisResult, twiml, appointment, conversationHistory);

            case 'NEED_MORE_INFO':
                return await handleNeedMoreInfo(appointmentId, analysisResult, twiml, appointment);

            case 'AMBIGUOUS':
                return await handleAmbiguousResponse(appointmentId, analysisResult, twiml, appointment, transcribedText);
            
            case 'UNCLEAR':
            default:
                return await handleUnclearResponse(appointmentId, analysisResult, twiml, appointment, transcribedText);
        }

    } catch (error) {
        console.error(`[ERROR] handleAppointmentResponse: Critical error for ${appointmentId}:`, error.message, error.stack);
        
        // Log critical error
        try {
            await addToConversationHistory(appointmentId, 'system', `Critical error: ${error.message}`, { error: true, critical: true });
        } catch (logError) {
            console.error(`[ERROR] Could not log critical error: ${logError.message}`);
        }

        twiml.say({ voice: 'alice', rate: 'medium' }, "I'm experiencing technical difficulties. A representative will contact you shortly to complete the appointment booking. Goodbye.");
        twiml.hangup();
        return twiml;
    }
}

// --- Helper functions for handling different response types ---

async function handleTimeSuggestion(appointmentId, analysisResult, twiml, appointment) {
    try {
        let suggestedTime;
        let formattedTime;
        
        // Validate the suggested time
        try {
            suggestedTime = new Date(analysisResult.suggested_iso_string);
            if (isNaN(suggestedTime.getTime())) {
                throw new Error('Invalid date');
            }
            
            // Check if the suggested time is in the past
            const now = new Date();
            if (suggestedTime < now) {
                await addToConversationHistory(appointmentId, 'assistant', 'I noticed that time is in the past. Let me ask for a future time.');
                const gather = twiml.gather({
                    input: 'speech',
                    action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
                    speechTimeout: 'auto'
                });
                gather.say({ voice: 'alice', rate: 'medium' }, "I noticed that time has already passed. Could you suggest a future date and time for the appointment?");
                twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
                return twiml;
            }
            
            formattedTime = suggestedTime.toLocaleString('en-US', { 
                weekday: 'long', 
                month: 'long',
                day: 'numeric',
                hour: 'numeric', 
                minute: 'numeric', 
                hour12: true 
            });
            
        } catch (dateError) {
            console.error(`[ERROR] Invalid date format from Gemini: ${analysisResult.suggested_iso_string}`);
            await addToConversationHistory(appointmentId, 'system', `Date parsing failed: ${dateError.message}`, { error: true });
            
            const gather = twiml.gather({
                input: 'speech',
                action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
                speechTimeout: 'auto'
            });
            gather.say({ voice: 'alice', rate: 'medium' }, "I had trouble understanding the exact time. Could you please be more specific about the date and time you prefer?");
            twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
            return twiml;
        }

        const confirmationQuestion = `Perfect! Just to confirm, you'd like to schedule the appointment for ${formattedTime}. Is that correct?`;
        
        await addToConversationHistory(appointmentId, 'assistant', confirmationQuestion);
        await updateConversationState(appointmentId, CONVERSATION_STATES.CONFIRMING_TIME, {
            suggestedTime: analysisResult.suggested_iso_string,
            confidence: analysisResult.confidence || 'medium'
        });

        const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(analysisResult.suggested_iso_string)}`;
        
        const gatherConfirm = twiml.gather({ 
            input: 'speech', 
            action: confirmationUrl, 
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations'
        });
        gatherConfirm.say({ voice: 'alice', rate: 'medium' }, confirmationQuestion);
        twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] handleTimeSuggestion: ${error.message}`);
        throw error;
    }
}

async function handleCannotSchedule(appointmentId, analysisResult, twiml, appointment) {
    const response = analysisResult.should_retry ? 
        "I understand. Is there anything else I can help clarify about the appointment? Otherwise, a representative will follow up with you." :
        "I understand. Thank you for letting me know. I'll make sure this information is relayed appropriately.";
    
    await addToConversationHistory(appointmentId, 'assistant', response);
    
    if (analysisResult.should_retry) {
        await updateConversationState(appointmentId, CONVERSATION_STATES.HANDLING_QUESTION);
        const gather = twiml.gather({
            input: 'speech',
            action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
            speechTimeout: 'auto'
        });
        gather.say({ voice: 'alice', rate: 'medium' }, response);
        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
    } else {
        twiml.say({ voice: 'alice', rate: 'medium' }, response + " Goodbye.");
        twiml.hangup();
        await updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { 
            failureReason: `Client cannot schedule: ${analysisResult.reason}` 
        });
    }
    
    return twiml;
}

async function handleUserQuestion(appointmentId, analysisResult, twiml, appointment, conversationHistory) {
    try {
        const questionType = analysisResult.question_type || 'general';
        
        let answerPrompt;
        if (questionType === 'availability') {
            answerPrompt = `The user is asking about availability for scheduling an appointment.
            Appointment details: For ${appointment.userName} regarding ${appointment.reasonForAppointment || 'medical consultation'}.
            User's question: "${analysisResult.question}"
            
            Provide a helpful response about general availability (mention they can suggest any time that works for them), 
            then ask again "What time would work best for your appointment?"
            Keep response under 25 words for the answer, then ask the question.`;
        } else {
            answerPrompt = `The user has a question about scheduling an appointment.
            Appointment details: For ${appointment.userName} regarding ${appointment.reasonForAppointment || 'medical consultation'}.
            User's question: "${analysisResult.question}"
            
            Provide a brief, helpful answer (under 20 words), then ask "What time would work best for your appointment?"`;
        }
        
        let answerText;
        try {
            answerText = await generateGeminiText(answerPrompt);
        } catch (geminiError) {
            answerText = "I'd be happy to help with that. What time would work best for your appointment?";
        }
        
        await addToConversationHistory(appointmentId, 'assistant', answerText, { questionType });
        await updateConversationState(appointmentId, CONVERSATION_STATES.ASKING_TIME);
        
        const gatherQuestion = twiml.gather({ 
            input: 'speech', 
            action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations'
        });
        gatherQuestion.say({ voice: 'alice', rate: 'medium' }, answerText);
        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] handleUserQuestion: ${error.message}`);
        throw error;
    }
}

async function handleNeedMoreInfo(appointmentId, analysisResult, twiml, appointment) {
    const infoNeeded = analysisResult.what_they_need || 'appointment details';
    
    let response;
    if (infoNeeded.includes('doctor') || infoNeeded.includes('provider')) {
        response = `This appointment is for ${appointment.reasonForAppointment || 'a medical consultation'}. What time would work best for you?`;
    } else if (infoNeeded.includes('location') || infoNeeded.includes('where')) {
        response = `You'll receive location details once the appointment is confirmed. What time would work best for you?`;
    } else {
        response = `I can provide more details once we schedule the time. What time would work best for your appointment?`;
    }
    
    await addToConversationHistory(appointmentId, 'assistant', response, { infoRequested: infoNeeded });
    
    const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
        speechTimeout: 'auto'
    });
    gather.say({ voice: 'alice', rate: 'medium' }, response);
    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
    
    return twiml;
}

async function handleAmbiguousResponse(appointmentId, analysisResult, twiml, appointment, transcribedText) {
    const clarificationNeeded = analysisResult.clarification_needed || 'a specific date and time';
    const interpretation = analysisResult.interpretation || transcribedText;
    
    await addToConversationHistory(appointmentId, 'system', `Ambiguous response: ${interpretation}`, { ambiguous: true });
    
    const clarificationPrompt = `I want to make sure I understand correctly. Could you please be more specific about ${clarificationNeeded}?`;
    
    await addToConversationHistory(appointmentId, 'assistant', clarificationPrompt);
    await updateConversationState(appointmentId, CONVERSATION_STATES.CLARIFYING_TIME);
    
    const gather = twiml.gather({
        input: 'speech',
        action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`,
        speechTimeout: 'auto'
    });
    gather.say({ voice: 'alice', rate: 'medium' }, clarificationPrompt);
    twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
    
    return twiml;
}

async function handleUnclearResponse(appointmentId, analysisResult, twiml, appointment, transcribedText) {
    const appointmentRef = await getAppointmentRef(appointmentId);
    const currentAppointment = (await appointmentRef.get()).data();
    const retries = (currentAppointment.retries || 0) + 1;
    const clarificationAttempts = (currentAppointment.clarificationAttempts || 0) + 1;
    
    await appointmentRef.update({ 
        retries: retries,
        clarificationAttempts: clarificationAttempts
    });
    
    await addToConversationHistory(appointmentId, 'system', `Unclear response (attempt ${retries}): ${transcribedText}`, { 
        unclear: true, 
        transcriptionQuality: analysisResult.transcription_quality 
    });

    if (retries >= MAX_RETRIES || clarificationAttempts >= MAX_CLARIFICATION_ATTEMPTS) {
        const finalMessage = "I'm having trouble understanding. A representative will contact you shortly to help schedule your appointment. Thank you for your patience. Goodbye.";
        
        twiml.say({ voice: 'alice', rate: 'medium' }, finalMessage);
        twiml.hangup();
        
        await updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { 
            failureReason: `Repeatedly unclear responses after ${retries} attempts. Last transcription: "${transcribedText}"`,
            maxRetriesReached: true
        });
    } else {
        const clarificationMessage = retries === 1 ? 
            "I'm sorry, I didn't quite catch that. Could you please tell me what date and time would work best for your appointment?" :
            "I'm still having trouble hearing you clearly. Could you please speak a bit louder and tell me your preferred appointment time?";
        
        await addToConversationHistory(appointmentId, 'assistant', clarificationMessage);
        
        const gather = twiml.gather({ 
            input: 'speech', 
            action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
            speechTimeout: 'auto',
            speechModel: 'experimental_conversations'
        });
        gather.say({ voice: 'alice', rate: 'medium' }, clarificationMessage);
        twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
    }
    
    return twiml;
}

export async function handleConfirmationResponse(appointmentId, transcribedText, timeToConfirmISO, timedOut) {
    console.log(`[INFO] handleConfirmationResponse: Starting for appointmentId: ${appointmentId}`);
    const twiml = new twilio.twiml.VoiceResponse();
    
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const appointment = (await appointmentRef.get()).data();
        const conversationHistory = await getConversationHistory(appointmentId);

        if (timedOut) {
            await addToConversationHistory(appointmentId, 'system', 'Confirmation timeout', { timeout: true });
            
            const retries = (appointment.confirmationRetries || 0) + 1;
            if (retries >= 2) {
                twiml.say({ voice: 'alice', rate: 'medium' }, "I didn't get a confirmation. A representative will call you back to finalize the appointment details. Goodbye.");
                twiml.hangup();
                await updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { 
                    failureReason: 'Multiple confirmation timeouts',
                    lastSuggestedTime: timeToConfirmISO
                });
            } else {
                await appointmentRef.update({ confirmationRetries: retries });
                const suggestedTime = new Date(timeToConfirmISO);
                const formattedTime = suggestedTime.toLocaleString('en-US', { 
                    weekday: 'long', 
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric', 
                    minute: 'numeric', 
                    hour12: true 
                });
                
                const retryMessage = `I didn't hear a response. To confirm the appointment for ${formattedTime}, please say 'yes' or 'no'.`;
                const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
                
                const gatherRetry = twiml.gather({ 
                    input: 'speech', 
                    action: confirmationUrl, 
                    speechTimeout: 'auto',
                    speechModel: 'experimental_conversations'
                });
                gatherRetry.say({ voice: 'alice', rate: 'medium' }, retryMessage);
                twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
            }
            return twiml;
        }

        // Validate transcription
        if (!transcribedText || transcribedText.trim().length === 0) {
            await addToConversationHistory(appointmentId, 'user', '[no audio in confirmation]', { silent: true });
            
            const suggestedTime = new Date(timeToConfirmISO);
            const formattedTime = suggestedTime.toLocaleString('en-US', { 
                weekday: 'long', 
                month: 'long',
                day: 'numeric',
                hour: 'numeric', 
                minute: 'numeric', 
                hour12: true 
            });
            
            const clarifyMessage = `I couldn't hear you. To confirm your appointment for ${formattedTime}, please say 'yes' if this time works, or 'no' if you'd like a different time.`;
            const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
            
            const gatherClarify = twiml.gather({ 
                input: 'speech', 
                action: confirmationUrl, 
                speechTimeout: 'auto'
            });
            gatherClarify.say({ voice: 'alice', rate: 'medium' }, clarifyMessage);
            twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
            return twiml;
        }

        await addToConversationHistory(appointmentId, 'user', transcribedText, { confirmationResponse: true });

        // Analyze confirmation with context
        let confirmationClassification;
        try {
            const suggestedTime = new Date(timeToConfirmISO);
            const formattedTime = suggestedTime.toLocaleString('en-US', { 
                weekday: 'long', 
                month: 'long',
                day: 'numeric',
                hour: 'numeric', 
                minute: 'numeric', 
                hour12: true 
            });
            
            const classificationPrompt = getAffirmativeNegativeClassificationPrompt(transcribedText, formattedTime, conversationHistory);
            const classificationRaw = await generateGeminiText(classificationPrompt);
            confirmationClassification = classificationRaw.trim().toUpperCase();
        } catch (geminiError) {
            console.error(`[ERROR] Gemini failed for confirmation classification:`, geminiError.message);
            confirmationClassification = 'UNCLEAR';
        }

        console.log(`[INFO] Confirmation classification for ${appointmentId}: ${confirmationClassification}`);

        if (confirmationClassification === 'AFFIRMATIVE') {
            const successMessage = "Excellent! Your appointment is confirmed. You'll receive a confirmation message with all the details shortly. Thank you, and goodbye.";
            
            twiml.say({ voice: 'alice', rate: 'medium' }, successMessage);
            twiml.hangup();
            
            await addToConversationHistory(appointmentId, 'assistant', successMessage, { final: true });
            await updateConversationState(appointmentId, CONVERSATION_STATES.COMPLETED, {
                finalAppointmentTime: new Date(timeToConfirmISO),
                confirmedAt: new Date().toISOString(),
                notes: `Appointment confirmed for ${new Date(timeToConfirmISO).toLocaleString()}. Final confirmation: "${transcribedText}"`
            });
            
        } else if (confirmationClassification === 'NEGATIVE') {
            const retryMessage = "No problem! Let's find a better time. What time would work better for your appointment?";
            
            await addToConversationHistory(appointmentId, 'assistant', retryMessage, { retryingTime: true });
            await updateConversationState(appointmentId, CONVERSATION_STATES.ASKING_TIME, {
                rejectedTime: timeToConfirmISO,
                rejectedAt: new Date().toISOString()
            });
            
            const gatherRetry = twiml.gather({ 
                input: 'speech', 
                action: `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}`, 
                speechTimeout: 'auto',
                speechModel: 'experimental_conversations'
            });
            gatherRetry.say({ voice: 'alice', rate: 'medium' }, retryMessage);
            twiml.redirect({ method: 'POST' }, `/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&timedOut=true`);
            
        } else { // UNCLEAR
            const clarificationAttempts = (appointment.confirmationClarifications || 0) + 1;
            await appointmentRef.update({ confirmationClarifications: clarificationAttempts });
            
            if (clarificationAttempts >= 2) {
                const escalateMessage = "I'm having trouble understanding your response. A representative will contact you shortly to finalize the appointment. Thank you for your patience. Goodbye.";
                
                twiml.say({ voice: 'alice', rate: 'medium' }, escalateMessage);
                twiml.hangup();
                
                await updateConversationState(appointmentId, CONVERSATION_STATES.FAILED, { 
                    failureReason: `Unable to get clear confirmation after ${clarificationAttempts} attempts. Last response: "${transcribedText}"`,
                    suggestedTime: timeToConfirmISO
                });
            } else {
                const suggestedTime = new Date(timeToConfirmISO);
                const formattedTime = suggestedTime.toLocaleString('en-US', { 
                    weekday: 'long', 
                    month: 'long',
                    day: 'numeric',
                    hour: 'numeric', 
                    minute: 'numeric', 
                    hour12: true 
                });
                
                const clarifyMessage = `I need to confirm your appointment time. For ${formattedTime}, please clearly say 'yes' to confirm or 'no' to choose a different time.`;
                const confirmationUrl = `/api/twilio/twiML/handleConfirmation?appointmentId=${appointmentId}&timeToConfirm=${encodeURIComponent(timeToConfirmISO)}`;
                
                await addToConversationHistory(appointmentId, 'assistant', clarifyMessage, { clarificationAttempt: clarificationAttempts });
                
                const gatherUnclear = twiml.gather({ 
                    input: 'speech', 
                    action: confirmationUrl, 
                    speechTimeout: 'auto',
                    speechModel: 'experimental_conversations'
                });
                gatherUnclear.say({ voice: 'alice', rate: 'medium' }, clarifyMessage);
                twiml.redirect({ method: 'POST' }, confirmationUrl + '&timedOut=true');
            }
        }
        
        return twiml;
    } catch (error) {
        console.error(`[ERROR] handleConfirmationResponse: Critical error for ${appointmentId}:`, error.message, error.stack);
        
        try {
            await addToConversationHistory(appointmentId, 'system', `Confirmation error: ${error.message}`, { error: true, critical: true });
        } catch (logError) {
            console.error(`[ERROR] Could not log confirmation error: ${logError.message}`);
        }

        twiml.say({ voice: 'alice', rate: 'medium' }, "I'm experiencing technical difficulties. A representative will contact you to confirm your appointment. Goodbye.");
        twiml.hangup();
        return twiml;
    }
}

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

        // Handle different call statuses with better context
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
            // Only mark as failed if the conversation was not explicitly completed or already failed
            if (currentState === CONVERSATION_STATES.CALLING || 
                currentState === CONVERSATION_STATES.INITIAL_GREETING ||
                currentState === CONVERSATION_STATES.ASKING_TIME) {
                
                updatePayload = { 
                    ...updatePayload,
                    status: 'failed', 
                    failureReason: 'Call ended unexpectedly without completing the appointment booking.',
                    conversationState: CONVERSATION_STATES.FAILED
                };
                await addToConversationHistory(appointmentId, 'system', 'Call ended unexpectedly', { unexpectedEnd: true });
            }
            // If already completed or failed through our flow, don't override
            
        } else if (callStatus === 'in-progress') {
            updatePayload = { 
                ...updatePayload,
                conversationState: CONVERSATION_STATES.INITIAL_GREETING,
                callInProgress: true,
                callAnsweredAt: new Date().toISOString()
            };
            await addToConversationHistory(appointmentId, 'system', 'Call answered and in progress', { callAnswered: true });
        }
        
        // Only update if we have meaningful changes
        if (Object.keys(updatePayload).length > 1) { // More than just lastCallStatus
            console.log(`[INFO] updateCallStatus: Updating appointment ${appointmentId}:`, updatePayload);
            await appointmentRef.update(updatePayload);
        } else {
            // Just update the call status for tracking
            await appointmentRef.update({ lastCallStatus: callStatus });
        }
        
    } catch (error) {
        console.error(`[ERROR] updateCallStatus: Could not update status for ${appointmentId}. Error: ${error.message}`, error.stack);
        
        // Try to log the error in conversation history
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