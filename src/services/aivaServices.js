// src/services/aivaService.js
import { db } from '../config/firebaseAdmin.js';
import { generateGeminiText } from '../utils/geminiClient.js';
import { v4 as uuidv4 } from 'uuid';

export const AIVA_INITIAL_GREETING = "Hi there! I'm Aiva, your personal AI assistant. I'm here to simplify your day by helping with receiving and replying to phone calls, managing your emails, assisting with booking appointments, and even helping you remind about payments. What can I do for you today?";

export const ConversationStates = {
  AWAITING_USER_REQUEST: 'AWAITING_USER_REQUEST',
  AWAITING_INTENT_CONFIRMATION: 'AWAITING_INTENT_CONFIRMATION',
  AWAITING_AFFIRMATIVE_NEGATIVE: 'AWAITING_AFFIRMATIVE_NEGATIVE',
  PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT: 'PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT',
  AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT: 'AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT',
  CONVERSATION_ENDED_OR_COMPLETED_TASK: 'CONVERSATION_ENDED_OR_COMPLETED_TASK',
  PROMPT_EMAIL_MONITORING_PREFERENCES: 'PROMPT_EMAIL_MONITORING_PREFERENCES',
  PROCESSING_EMAIL_MONITORING_PREFERENCES: 'PROCESSING_EMAIL_MONITORING_PREFERENCES', // This might be redundant if preference is set in PROMPT state.
};

const IntentCategories = {
  MONITOR_EMAIL: 'MONITOR_EMAIL',
  PAYMENT_REMINDER: 'PAYMENT_REMINDER',
  APPOINTMENT_CALL: 'APPOINTMENT_CALL',
  MANAGE_CALLS: 'MANAGE_CALLS',
  CONVERSATIONAL_QUERY: 'CONVERSATIONAL_QUERY', // New: For fluid conversation
  NONE_OF_THE_ABOVE: 'NONE_OF_THE_ABOVE',
  OUT_OF_CONTEXT: 'OUT_OF_CONTEXT'
};

// Define categories for email monitoring preferences
const EmailMonitoringPreferences = {
  NOTIFY_ONLY: 'NOTIFY_ONLY',
  ASSIST_REPLY: 'ASSIST_REPLY',
  BOTH: 'BOTH', // Will be consolidated to ASSIST_REPLY for storage
  UNCLEAR: 'UNCLEAR'
};

// --- Helper for deleting subcollections ---
async function deleteCollection(collectionPath, batchSize = 100) {
  const collectionRef = db.collection(collectionPath);
  const query = collectionRef.orderBy('__name__').limit(batchSize);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(query, resolve) {
  const snapshot = await query.get();
  if (snapshot.size === 0) {
    resolve();
    return;
  }
  const batch = db.batch();
  snapshot.docs.forEach((doc) => {
    batch.delete(doc.ref);
  });
  await batch.commit();
  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}

// --- New Chat Management Functions ---
export async function createNewChat(userId, chatName = "New Chat") {
  if (!db) throw new Error('Database not initialized.');
  const chatId = uuidv4();
  const chatRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId);

  const initialChatState = {
    chatId,
    userId,
    chatName,
    currentState: ConversationStates.AWAITING_USER_REQUEST,
    lastProposedIntent: null,
    lastAivaMessageId: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await chatRef.set(initialChatState);

  const initialMessage = {
    role: 'assistant',
    content: AIVA_INITIAL_GREETING,
    timestamp: new Date().toISOString(),
  };
  const initialMessageRef = await addMessageToHistory(userId, chatId, initialMessage.role, initialMessage.content, ConversationStates.AWAITING_USER_REQUEST);
  await chatRef.update({ lastAivaMessageId: initialMessageRef.id, updatedAt: new Date().toISOString() });

  console.log(`aivaService: New chat created for user ${userId} with chatId ${chatId}`);
  return {
    chatId,
    chatName,
    initialMessage: {
        id: initialMessageRef.id,
        text: initialMessage.content,
        sender: 'ai',
        timestamp: initialMessage.timestamp
    },
    currentState: initialChatState.currentState,
  };
}

export async function deleteChat(userId, chatId) {
  if (!db) throw new Error('Database not initialized.');
  const chatRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId);
  const messagesPath = `users/${userId}/aivaChats/${chatId}/messages`;

  console.log(`aivaService: Attempting to delete messages for chat ${chatId} at path ${messagesPath}`);
  await deleteCollection(messagesPath);
  console.log(`aivaService: Messages deleted for chat ${chatId}. Deleting chat document.`);
  await chatRef.delete();
  console.log(`aivaService: Chat ${chatId} deleted successfully for user ${userId}.`);
  return { message: `Chat ${chatId} deleted successfully.` };
}

export async function listUserChats(userId) {
  if (!db) {
    console.error('aivaService: Database not initialized in listUserChats.');
    throw new Error('Database not initialized.');
  }
  if (!userId) {
    console.error('aivaService: userId not provided to listUserChats.');
    throw new Error('User ID is required to list chats.');
  }
  try {
    const chatsRef = db.collection('users').doc(userId).collection('aivaChats');
    const snapshot = await chatsRef.orderBy('createdAt', 'desc').get();
    if (snapshot.empty) {
      console.log(`aivaService: No chats found for user ${userId}.`);
      return [];
    }
    const chats = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      chats.push({
        id: doc.id,
        name: data.chatName || "Chat",
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
      });
    });
    console.log(`aivaService: Found ${chats.length} chats for user ${userId}.`);
    return chats;
  } catch (error) {
    console.error(`aivaService: Error fetching chats for user ${userId}:`, error);
    throw error;
  }
}

// --- Core Conversation Functions ---
async function getConversationState(userId, chatId) {
  const chatRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) {
    console.warn(`aivaService: Chat with ID ${chatId} not found for user ${userId}.`);
    return null;
  }
  const chatData = chatSnap.data();
  console.log(`aivaService: Fetched conversation state for user ${userId}, chat ${chatId}: ${chatData.currentState}`);
  return chatData;
}

async function updateConversationState(userId, chatId, newState, updates = {}) {
  const chatRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId);
  const updatePayload = {
    currentState: newState,
    updatedAt: new Date().toISOString(),
    ...updates
  };
  await chatRef.update(updatePayload);
  console.log(`aivaService: Updated chat state for user ${userId}, chat ${chatId} to ${newState}, updates:`, updates);
}

async function addMessageToHistory(userId, chatId, role, content, stateWhenSent = null, intentContext = null) {
  const messageData = {
    userId,
    chatId,
    role,
    content,
    timestamp: new Date().toISOString(),
    stateWhenSent,
    ...(intentContext && { intentContext })
  };
  const messageRef = await db.collection('users').doc(userId).collection('aivaChats').doc(chatId).collection('messages').add(messageData);
  console.log(`aivaService: Added message to history for user ${userId}, chat ${chatId}, role: ${role}`);
  return messageRef;
}

export async function getChatHistory(userId, chatId, limit = 20) {
    const messagesRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId).collection('messages');
    const snapshot = await messagesRef.orderBy('timestamp', 'desc').limit(limit).get();
    if (snapshot.empty) return [];
    const history = [];
    snapshot.forEach(doc => history.push({ id: doc.id, ...doc.data() }));
    return history.reverse();
}

// --- Prompts ---
function getInitialIntentClassificationPrompt(userMessage) {
  return `User message: "${userMessage}"
Classify this message into one of the following intents:
1. ${IntentCategories.MONITOR_EMAIL} (for managing or monitoring emails)
2. ${IntentCategories.PAYMENT_REMINDER} (for setting up payment reminders)
3. ${IntentCategories.APPOINTMENT_CALL} (for making a phone call to book an appointment)
4. ${IntentCategories.MANAGE_CALLS} (for managing incoming/outgoing phone calls in general)
5. ${IntentCategories.CONVERSATIONAL_QUERY} (if it's a simple greeting, a question about Aiva's abilities like "what can you do?", or a follow-up comment that is not a direct command)
6. ${IntentCategories.NONE_OF_THE_ABOVE} (if it doesn't fit any of the above but is still related to general productivity)
If the user's message is completely out of context or unrelated to these tasks (e.g., asking about the weather, philosophy), return "${IntentCategories.OUT_OF_CONTEXT}".
Return ONLY the intent label.`;
}

function getConversationalResponsePrompt(chatHistory, userMessage) {
    const historyString = chatHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
    return `You are Aiva, a personal AI assistant. Your primary functions are: helping with payment reminders, monitoring emails, managing phone calls, and booking appointments.
    
    Review the recent conversation history and the latest user message. Generate a helpful, natural response. Your goal is to be friendly and guide the conversation back towards one of your core functions without being repetitive.
    
    Conversation History:
    ${historyString}
    
    Latest User Message:
    user: "${userMessage}"
    
    Generate Aiva's next response:`;
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
- "task_description": What the payment is for (e.g., "credit card bill", "rent payment").
- "reminder_date": The date for the reminder (e.g., "next Tuesday", "July 15th", "tomorrow").
- "reminder_time": The specific time for the reminder, if mentioned (e.g., "at 3 PM", "around noon", "evening").

Return this information as a VALID JSON object with exactly these keys. If a piece of information is not found, use null for its value.
Example 1 (all details): {"task_description": "credit card bill", "reminder_date": "July 15th", "reminder_time": "3:00 PM"}
Example 2 (no time): {"task_description": "rent payment", "reminder_date": "next Tuesday", "reminder_time": null}
Example 3 (only task): {"task_description": "electricity bill", "reminder_date": null, "reminder_time": null}
If the user's message doesn't seem to contain any of these specific details or is asking a question, return an empty JSON object like {}.
Ensure the output is ONLY the JSON object.`;
}

function getEmailMonitoringPreferenceClassificationPrompt(userMessage) {
  return `The user has confirmed they want help with email monitoring.
Aiva asked: "Okay, for email monitoring, would you like me to just notify you of important emails, or would you also like me to help draft replies to some of them?"
User's reply: "${userMessage}"

Classify this reply into one of the following preferences:
1. ${EmailMonitoringPreferences.NOTIFY_ONLY} (if the user only wants notifications, alerts, or to be informed about important emails)
2. ${EmailMonitoringPreferences.ASSIST_REPLY} (if the user wants help with replying, drafting emails, or responding)
3. ${EmailMonitoringPreferences.BOTH} (if the user explicitly mentions wanting both notifications and help with replies)
4. ${EmailMonitoringPreferences.UNCLEAR} (if the user's response is ambiguous, doesn't answer the question, or asks another question)

Return ONLY the preference label (e.g., "${EmailMonitoringPreferences.NOTIFY_ONLY}").`;
}


// --- Function to check for mid-chat intent change ---
async function checkForIntentChange(currentUserIntent, userMessageContent) {
    console.log(`aivaService: Checking for intent change. Current task intent: ${currentUserIntent}`);
    const potentialNewIntentRaw = await generateGeminiText(getInitialIntentClassificationPrompt(userMessageContent));
    const potentialNewIntent = potentialNewIntentRaw ? potentialNewIntentRaw.trim().toUpperCase() : null;

    // We only consider it a "change" if it's one of the core, actionable tasks
    const coreTasks = [IntentCategories.MONITOR_EMAIL, IntentCategories.PAYMENT_REMINDER, IntentCategories.APPOINTMENT_CALL, IntentCategories.MANAGE_CALLS];

    if (potentialNewIntent && coreTasks.includes(potentialNewIntent) && potentialNewIntent !== currentUserIntent) {
        console.log(`aivaService: Detected potential intent change from ${currentUserIntent} to ${potentialNewIntent}`);
        return potentialNewIntent;
    }
    return null;
}


// --- Main Service Logic ---
export async function handleUserMessage(userId, chatId, userMessageContent) {
  if (!db) throw new Error('Database not initialized.');
  if (!chatId) throw new Error('chatId is required to handle user message.');

  const conversationState = await getConversationState(userId, chatId);
  if (!conversationState) {
    console.error(`handleUserMessage: No conversation state found for userId ${userId}, chatId ${chatId}.`);
    return {
        id: null,
        aivaResponse: "Sorry, I couldn't find our current conversation. Please try starting a new chat.",
        currentState: null, chatId: chatId, userId: userId, error: "Conversation not found"
    };
  }

  await addMessageToHistory(userId, chatId, 'user', userMessageContent, conversationState.currentState);

  let aivaResponseContent = "I'm not sure how to respond to that right now.";
  let nextState = conversationState.currentState;
  let additionalResponseParams = {};

  // --- Handle potential mid-conversation intent change ---
  const currentTaskIntent = conversationState.lastProposedIntent;
  // Check for a switch only if we are already in a specific task flow
  if (currentTaskIntent && conversationState.currentState !== ConversationStates.AWAITING_USER_REQUEST && conversationState.currentState !== ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT) {
      const newIntent = await checkForIntentChange(currentTaskIntent, userMessageContent);
      if (newIntent) {
          // User might want to switch tasks. Let's confirm.
          let intentSummary = `It looks like you want to switch gears and get help with ${newIntent.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
          aivaResponseContent = intentSummary;
          nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
          await updateConversationState(userId, chatId, nextState, { lastProposedIntent: newIntent }); // Propose the NEW intent
          
          const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', aivaResponseContent, nextState);
          await db.collection('users').doc(userId).collection('aivaChats').doc(chatId).update({ lastAivaMessageId: aivaMessageRef.id, updatedAt: new Date().toISOString() });

          return {
              id: aivaMessageRef.id, aivaResponse: aivaResponseContent, currentState: nextState, chatId, userId, ...additionalResponseParams
          };
      }
  }


  switch (conversationState.currentState) {
    case ConversationStates.AWAITING_USER_REQUEST:
    case ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT:
      const classifiedIntentRaw = await generateGeminiText(getInitialIntentClassificationPrompt(userMessageContent));
      console.log(`aivaService: Gemini initial intent classification raw response: "${classifiedIntentRaw}"`);
      const classifiedIntent = classifiedIntentRaw ? classifiedIntentRaw.trim().toUpperCase() : null;

      if (classifiedIntent && Object.values(IntentCategories).includes(classifiedIntent)) {
        if (classifiedIntent === IntentCategories.NONE_OF_THE_ABOVE || classifiedIntent === IntentCategories.OUT_OF_CONTEXT) {
          aivaResponseContent = "I see. I can primarily help with email monitoring, payment reminders, appointment calls, and managing phone calls. Is there something specific in these areas you need assistance with?";
          nextState = ConversationStates.AWAITING_USER_REQUEST;
          await updateConversationState(userId, chatId, nextState);
        } else if (classifiedIntent === IntentCategories.CONVERSATIONAL_QUERY) {
            const chatHistory = await getChatHistory(userId, chatId, 10);
            const geminiPrompt = getConversationalResponsePrompt(chatHistory, userMessageContent);
            aivaResponseContent = await generateGeminiText(geminiPrompt);
            nextState = ConversationStates.AWAITING_USER_REQUEST; // Stay in a general state, ready for a command
            await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null }); // Clear any previous intent
        } else {
          // This is a core task, so we confirm it
          let intentSummary = `It sounds like you're looking for help with ${classifiedIntent.toLowerCase().replace(/_/g, ' ')}.`;
          if (classifiedIntent === IntentCategories.MONITOR_EMAIL) intentSummary = "It sounds like you'd like me to help with monitoring your emails.";
          else if (classifiedIntent === IntentCategories.PAYMENT_REMINDER) intentSummary = "It sounds like you want to set up a payment reminder.";
          
          aivaResponseContent = `${intentSummary} Is that correct?`;
          nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
          await updateConversationState(userId, chatId, nextState, { lastProposedIntent: classifiedIntent });
        }
      } else {
        aivaResponseContent = "I'm having a little trouble understanding that. Could you please rephrase, or tell me if it's about emails, payments, appointments, or phone calls?";
        nextState = ConversationStates.AWAITING_USER_REQUEST;
        await updateConversationState(userId, chatId, nextState);
      }
      break;

    case ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE:
      const geminiPrompt = getAffirmativeNegativeClassificationPrompt(userMessageContent, conversationState.lastProposedIntent);
      const confirmationResultRaw = await generateGeminiText(geminiPrompt);
      console.log(`aivaService: Gemini affirmative/negative raw response: "${confirmationResultRaw}" for proposed intent: ${conversationState.lastProposedIntent}`);
      const confirmationResult = confirmationResultRaw ? confirmationResultRaw.trim().toUpperCase() : null;

      if (confirmationResult === 'AFFIRMATIVE') {
        const confirmedIntent = conversationState.lastProposedIntent;
        if (confirmedIntent === IntentCategories.PAYMENT_REMINDER) {
          aivaResponseContent = "Great! To set up the payment reminder, I'll need a bit more information. What is the payment for, when do you need to be reminded, and is there a specific time?";
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        } else if (confirmedIntent === IntentCategories.MONITOR_EMAIL) {
          aivaResponseContent = "Okay, for email monitoring, would you like me to just notify you of important emails, or would you also like me to help draft replies to some of them?";
          nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES;
        } else {
          aivaResponseContent = `Okay, we'll proceed with ${confirmedIntent.toLowerCase().replace(/_/g, ' ')}. (Path not fully implemented yet). What's the next step?`;
          nextState = ConversationStates.AWAITING_USER_REQUEST;
        }
        await updateConversationState(userId, chatId, nextState, { lastUserAffirmation: userMessageContent });
      } else if (confirmationResult === 'NEGATIVE') {
        aivaResponseContent = "My apologies for misunderstanding. Could you please tell me what you'd like to do then?";
        nextState = ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT;
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null });
      } else { // UNCLEAR
        aivaResponseContent = "Sorry, I didn't quite catch that. Was that a 'yes' or a 'no' regarding my previous question?";
        nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE; // Remain in this state
      }
      break;

    case ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES:
      const preferenceRaw = await generateGeminiText(getEmailMonitoringPreferenceClassificationPrompt(userMessageContent));
      console.log(`aivaService: Gemini email preference classification raw response: "${preferenceRaw}"`);
      const preference = preferenceRaw ? preferenceRaw.trim().toUpperCase() : EmailMonitoringPreferences.UNCLEAR;

      if (preference === EmailMonitoringPreferences.NOTIFY_ONLY || preference === EmailMonitoringPreferences.ASSIST_REPLY || preference === EmailMonitoringPreferences.BOTH) {
        let preferenceForStorage = preference === EmailMonitoringPreferences.BOTH ? EmailMonitoringPreferences.ASSIST_REPLY : preference;
        let preferenceText = preferenceForStorage === EmailMonitoringPreferences.ASSIST_REPLY ? "notifying you and assisting with replies" : "just notifying you of important emails";

        aivaResponseContent = `Got it. I'll proceed with ${preferenceText}. To do this, I'll need access to your emails. Please follow the prompt from the application to connect your email account.`;
        additionalResponseParams.initiateOAuth = 'google_email';
        nextState = ConversationStates.AWAITING_USER_REQUEST;

        try {
          const userRef = db.collection('users').doc(userId);
          await userRef.set({ settings: { emailMonitoringPreference: preferenceForStorage } }, { merge: true });
          console.log(`aivaService: Email monitoring preference '${preferenceForStorage}' stored for user ${userId}.`);
        } catch (dbError) {
          console.error(`aivaService: Failed to store email monitoring preference for user ${userId}:`, dbError);
        }
        await updateConversationState(userId, chatId, nextState, { emailMonitoringChatPreference: preferenceForStorage, lastProposedIntent: null });
      } else { // UNCLEAR preference
        aivaResponseContent = "Sorry, I didn't quite understand your preference. Would you like me to (1) only notify you of important emails, or (2) also help draft replies? Please specify 'notify only' or 'help reply'.";
        nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES;
        await updateConversationState(userId, chatId, nextState);
      }
      break;

    case ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT:
      const extractedDetailsRaw = await generateGeminiText(getPaymentDetailsExtractionPrompt(userMessageContent));
      console.log(`aivaService: Gemini payment details extraction raw response: "${extractedDetailsRaw}"`);
      let extractedDetails = {};
      try {
          const cleanedJsonString = extractedDetailsRaw.replace(/^```json\s*|```\s*$/g, '');
          extractedDetails = JSON.parse(cleanedJsonString);
          console.log('aivaService: Parsed payment details:', extractedDetails);
      } catch (e) {
          console.error("aivaService: Failed to parse JSON from Gemini for payment details. Raw:", extractedDetailsRaw, "Error:", e.message);
      }

      if (extractedDetails && (extractedDetails.task_description || extractedDetails.reminder_date)) {
        const reminderDataToStore = {
            userId,
            taskDescription: extractedDetails.task_description || "Not specified",
            reminderDate: extractedDetails.reminder_date || "Not specified",
            reminderTime: extractedDetails.reminder_time || 'any time',
            status: 'pending',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };

        let confirmationMsg = "Alright, I've set a reminder";
        if (reminderDataToStore.taskDescription !== "Not specified") { confirmationMsg += ` for "${reminderDataToStore.taskDescription}"`; }
        if (reminderDataToStore.reminderDate !== "Not specified") { confirmationMsg += ` on ${reminderDataToStore.reminderDate}`; }
        if (extractedDetails.reminder_time) { confirmationMsg += ` at ${extractedDetails.reminder_time}`; }
        confirmationMsg += (reminderDataToStore.taskDescription === "Not specified" && reminderDataToStore.reminderDate === "Not specified")
                         ? ". I couldn't get the task or date, though. Could you clarify?" : ".";

        if (reminderDataToStore.taskDescription === "Not specified" || reminderDataToStore.reminderDate === "Not specified") {
             aivaResponseContent = `${confirmationMsg} I missed some details. Can you provide the full task, date, and time again clearly?`;
             nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
             await updateConversationState(userId, chatId, nextState);
        } else {
            try {
                const reminderRef = await db.collection('users').doc(userId).collection('paymentReminders').add(reminderDataToStore);
                console.log(`aivaService: Payment reminder stored with ID: ${reminderRef.id} for user ${userId}`);
                aivaResponseContent = `${confirmationMsg} Is there anything else I can help you with?`;
                nextState = ConversationStates.AWAITING_USER_REQUEST;
                await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null, lastReminderId: reminderRef.id });
            } catch (error) {
                console.error(`aivaService: Failed to store payment reminder for user ${userId}:`, error);
                aivaResponseContent = "I was able to understand the details, but there was an issue saving your reminder. Please try again in a moment.";
                nextState = ConversationStates.AWAITING_USER_REQUEST;
                await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null });
            }
        }
      } else {
        aivaResponseContent = "I couldn't quite get all the details for the reminder. Could you please tell me again: what is the payment for, and when do you need the reminder (date and optionally time)?";
        nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        await updateConversationState(userId, chatId, nextState);
      }
      break;

    default:
      console.warn(`Unhandled conversation state: ${conversationState.currentState} for user ${userId}, chat ${chatId}`);
      aivaResponseContent = "I seem to be a bit lost in our conversation. Could we start over with what you need?";
      nextState = ConversationStates.AWAITING_USER_REQUEST;
      await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null });
  }

  const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', aivaResponseContent, nextState);
  await db.collection('users').doc(userId).collection('aivaChats').doc(chatId)
          .update({ lastAivaMessageId: aivaMessageRef.id, updatedAt: new Date().toISOString() });

  return {
    id: aivaMessageRef.id,
    aivaResponse: aivaResponseContent,
    currentState: nextState,
    chatId: chatId,
    userId: userId,
    ...additionalResponseParams
  };
}
