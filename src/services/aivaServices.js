// src/services/aivaService.js
import { db } from '../config/firebaseAdmin.js';
import  { generateGeminiText } from '../utils/geminiClient.js';

export const AIVA_INITIAL_GREETING = "Hi there! I'm Aiva, your personal AI assistant. I'm here to simplify your day by helping with receiving and replying to phone calls, managing your emails, assisting with booking appointments, and even helping you remind about payments. What can I do for you today?";

export const ConversationStates = {
  INITIAL: 'INITIAL',
  AWAITING_USER_REQUEST: 'AWAITING_USER_REQUEST', // After Aiva's greeting
  AWAITING_INTENT_CONFIRMATION: 'AWAITING_INTENT_CONFIRMATION',
  AWAITING_AFFIRMATIVE_NEGATIVE: 'AWAITING_AFFIRMATIVE_NEGATIVE',
  PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT: 'PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT', // Aiva asks for details
  PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_EXTRACT: 'PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_EXTRACT', // User provided details, Aiva extracts
  AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT: 'AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT', // User said "no" to intent, Aiva asks "what then?"
  // ... other path states
  CONVERSATION_ENDED_OR_COMPLETED_TASK: 'CONVERSATION_ENDED_OR_COMPLETED_TASK'
};

const IntentCategories = {
  MONITOR_EMAIL: 'MONITOR_EMAIL',
  PAYMENT_REMINDER: 'PAYMENT_REMINDER',
  APPOINTMENT_CALL: 'APPOINTMENT_CALL',
  MANAGE_CALLS: 'MANAGE_CALLS',
  NONE_OF_THE_ABOVE: 'NONE_OF_THE_ABOVE',
  OUT_OF_CONTEXT: 'OUT_OF_CONTEXT' // Added for clarity
};

// Helper to get or create conversation state
export async function getConversation(userId) {
  const conversationRef = db.collection('aivaConversations').doc(userId);
  const conversationSnap = await conversationRef.get();

  if (!conversationSnap.exists) {
    const initialState = {
      userId,
      currentState: ConversationStates.INITIAL,
      lastProposedIntent: null,
      lastAivaMessageId: null, // To track the last message Aiva sent for context
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await conversationRef.set(initialState);
    // Add initial greeting to chat history
    const initialMessageRef = await addMessageToHistory(userId, 'assistant', AIVA_INITIAL_GREETING, ConversationStates.INITIAL);
    await conversationRef.update({ lastAivaMessageId: initialMessageRef.id, updatedAt: new Date().toISOString() });
    return { ...initialState, id: conversationRef.id, lastAivaMessageId: initialMessageRef.id };
  }
  return { ...conversationSnap.data(), id: conversationSnap.id };
}

export async function updateConversationState(userId, newState, updates = {}) {
  const conversationRef = db.collection('aivaConversations').doc(userId);
  await conversationRef.update({
    currentState: newState,
    updatedAt: new Date().toISOString(),
    ...updates
  });
}

export async function addMessageToHistory(userId, role, content, stateWhenSent = null, intentContext = null) {
  const messageData = {
    userId,
    role, // 'user' or 'assistant'
    content,
    timestamp: new Date().toISOString(),
    stateWhenSent, // The conversation state when this message was generated/received
    ...(intentContext && { intentContext }) // e.g. { proposedIntent: 'PAYMENT_REMINDER' }
  };
  const messageRef = await db.collection('aivaConversations').doc(userId).collection('messages').add(messageData);
  return messageRef;
}

export async function getChatHistory(userId, limit = 10) {
    const messagesRef = db.collection('aivaConversations').doc(userId).collection('messages');
    const snapshot = await messagesRef.orderBy('timestamp', 'desc').limit(limit).get();
    if (snapshot.empty) {
        return [];
    }
    const history = [];
    snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));
    return history.reverse(); // oldest to newest
}

// --- Prompts for Gemini ---
function getInitialIntentClassificationPrompt(userMessage) {
  return `User message: "${userMessage}"
Classify this message into one of the following intents:
1. ${IntentCategories.MONITOR_EMAIL} (for managing or monitoring emails)
2. ${IntentCategories.PAYMENT_REMINDER} (for setting up payment reminders)
3. ${IntentCategories.APPOINTMENT_CALL} (for making a phone call to book an appointment)
4. ${IntentCategories.MANAGE_CALLS} (for managing incoming/outgoing phone calls in general)
5. ${IntentCategories.NONE_OF_THE_ABOVE} (if it doesn't fit any of the above, is unclear, or is a simple greeting/chit-chat)

If the user's message is completely out of context or unrelated to these tasks (e.g., asking about the weather, philosophy), return "${IntentCategories.OUT_OF_CONTEXT}".
Return ONLY the intent label (e.g., "${IntentCategories.MONITOR_EMAIL}").`;
}

function getAffirmativeNegativeClassificationPrompt(userReply, proposedIntentSummary) {
  return `The user was previously asked to confirm if their intent was related to: "${proposedIntentSummary}".
User's reply: "${userReply}"
Is this reply affirmative (e.g., yes, confirm, correct, sounds good) or negative (e.g., no, wrong, not that, incorrect)?
Return "AFFIRMATIVE" or "NEGATIVE". If it's unclear or neither, return "UNCLEAR".`;
}

function getPaymentDetailsExtractionPrompt(userMessage) {
  return `The user wants to set a payment reminder and has provided some details.
User's message: "${userMessage}"
Extract the following information:
- task_description (a short description of what the payment is for, e.g., "credit card bill", "rent payment")
- reminder_date (when to remind, e.g., "next Tuesday", "July 15th", "tomorrow")
- reminder_time (specific time if mentioned, e.g., "at 3 PM", "around noon", "in the evening")

Return this information as a VALID JSON object. If a piece of information is not found, use null for its value.
Example: {"task_description": "credit card bill", "reminder_date": "July 15th", "reminder_time": null}
If the user's message doesn't seem to contain these details or is asking a question instead, return an empty JSON object like {}.`;
}


// --- Main Service Logic ---
export async function handleUserMessage(userId, userMessageContent) {
  if (!db) {
    throw new Error('Database not initialized. Check Firebase Admin setup.');
  }

  const conversation = await getConversation(userId);
  await addMessageToHistory(userId, 'user', userMessageContent, conversation.currentState);

  let aivaResponseContent = "I'm not sure how to respond to that right now.";
  let nextState = conversation.currentState;
  let geminiPrompt = null;
  let geminiHistoryForPrompt = []; // For prompts that need conversational context

  switch (conversation.currentState) {
    case ConversationStates.INITIAL: // Should technically transition to AWAITING_USER_REQUEST after greeting
    case ConversationStates.AWAITING_USER_REQUEST:
    case ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT: // After user said "no" and Aiva asked "what then?"
      geminiPrompt = getInitialIntentClassificationPrompt(userMessageContent);
      const classifiedIntent = await generateGeminiText(geminiPrompt);

      if (classifiedIntent && Object.values(IntentCategories).includes(classifiedIntent.trim())) {
        const intent = classifiedIntent.trim();
        if (intent === IntentCategories.NONE_OF_THE_ABOVE || intent === IntentCategories.OUT_OF_CONTEXT) {
          // For now, a generic response. Later, this could be a fallback function.
          aivaResponseContent = "I see. I can primarily help with email monitoring, payment reminders, appointment calls, and managing phone calls. Is there something specific in these areas you need assistance with?";
          nextState = ConversationStates.AWAITING_USER_REQUEST; // Loop back
          await updateConversationState(userId, nextState);
        } else {
          // Summarize and ask for confirmation
          let intentSummary = `It sounds like you're looking for help with ${intent.toLowerCase().replace(/_/g, ' ')}.`;
          if (intent === IntentCategories.MONITOR_EMAIL) intentSummary = "It sounds like you'd like me to help with monitoring your emails.";
          else if (intent === IntentCategories.PAYMENT_REMINDER) intentSummary = "It sounds like you want to set up a payment reminder.";
          else if (intent === IntentCategories.APPOINTMENT_CALL) intentSummary = "It seems you're interested in making a phone call for an appointment.";
          else if (intent === IntentCategories.MANAGE_CALLS) intentSummary = "It looks like you need assistance with managing phone calls.";
          
          aivaResponseContent = `${intentSummary} Is that correct?`;
          nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
          await updateConversationState(userId, nextState, { lastProposedIntent: intent });
        }
      } else {
        aivaResponseContent = "I'm having a little trouble understanding that. Could you please rephrase, or tell me if it's about emails, payments, appointments, or phone calls?";
        nextState = ConversationStates.AWAITING_USER_REQUEST; // Stay in this state or a specific error state
        await updateConversationState(userId, nextState);
      }
      break;

    case ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE:
      geminiPrompt = getAffirmativeNegativeClassificationPrompt(userMessageContent, conversation.lastProposedIntent);
      const confirmationResult = await generateGeminiText(geminiPrompt);

      if (confirmationResult === 'AFFIRMATIVE') {
        const confirmedIntent = conversation.lastProposedIntent;
        // Proceed to the specific path
        if (confirmedIntent === IntentCategories.PAYMENT_REMINDER) {
          aivaResponseContent = "Great! To set up the payment reminder, I'll need a bit more information. What is the payment for, when do you need to be reminded, and is there a specific time?";
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        } else {
          // Placeholder for other paths
          aivaResponseContent = `Okay, we'll proceed with ${confirmedIntent.toLowerCase().replace(/_/g, ' ')}. (Path not fully implemented yet). What's the next step?`;
          nextState = ConversationStates.AWAITING_USER_REQUEST; // Or a specific path start state
        }
        await updateConversationState(userId, nextState, { lastUserAffirmation: userMessageContent });

      } else if (confirmationResult === 'NEGATIVE') {
        aivaResponseContent = "My apologies for misunderstanding. Could you please tell me what you'd like to do then?";
        nextState = ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT;
        await updateConversationState(userId, nextState, { lastProposedIntent: null });
      } else { // UNCLEAR or error
        aivaResponseContent = "Sorry, I didn't quite catch that. Was that a 'yes' or a 'no' regarding my previous question?";
        nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE; // Stay in this state
        await updateConversationState(userId, nextState);
      }
      break;

    case ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT: // User provides details for payment
      geminiPrompt = getPaymentDetailsExtractionPrompt(userMessageContent);
      const extractedDetailsRaw = await generateGeminiText(geminiPrompt);
      let extractedDetails;
      try {
          extractedDetails = extractedDetailsRaw ? JSON.parse(extractedDetailsRaw) : {};
      } catch (e) {
          console.error("Failed to parse JSON from Gemini for payment details:", extractedDetailsRaw, e);
          extractedDetails = {};
      }

      if (extractedDetails && extractedDetails.task_description && extractedDetails.reminder_date) {
        // Store these details in Firestore (e.g., in a 'reminders' collection or update user profile)
        // For now, just confirm
        const reminderData = {
            userId,
            task: extractedDetails.task_description,
            date: extractedDetails.reminder_date,
            time: extractedDetails.reminder_time || 'any time',
            createdAt: new Date().toISOString(),
            status: 'pending'
        };
        // Example: await db.collection('paymentReminders').add(reminderData);
        console.log('Extracted reminder details:', reminderData); // Log for now

        aivaResponseContent = `Alright, I've set a reminder for "${extractedDetails.task_description}" on ${extractedDetails.reminder_date}`;
        if(extractedDetails.reminder_time) aivaResponseContent += ` at ${extractedDetails.reminder_time}`;
        aivaResponseContent += `. Is there anything else I can help you with?`;
        nextState = ConversationStates.AWAITING_USER_REQUEST; // Reset for new request
        await updateConversationState(userId, nextState, { lastProposedIntent: null, extractedPaymentDetails: reminderData });
      } else {
        aivaResponseContent = "I couldn't quite get all the details for the reminder. Could you please tell me again: what is the payment for, and when do you need the reminder (date and optionally time)?";
        nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT; // Ask again
        await updateConversationState(userId, nextState);
      }
      break;

    default:
      console.warn(`Unhandled conversation state: ${conversation.currentState} for user ${userId}`);
      aivaResponseContent = "I seem to be a bit lost in our conversation. Could we start over with what you need?";
      nextState = ConversationStates.AWAITING_USER_REQUEST;
      await updateConversationState(userId, nextState, { lastProposedIntent: null });
  }

  const aivaMessageRef = await addMessageToHistory(userId, 'assistant', aivaResponseContent, nextState);
  await db.collection('aivaConversations').doc(userId).update({ lastAivaMessageId: aivaMessageRef.id, updatedAt: new Date().toISOString() });

  return {
    aivaResponse: aivaResponseContent,
    currentState: nextState,
    conversationId: conversation.id,
    userId: userId
  };
}


