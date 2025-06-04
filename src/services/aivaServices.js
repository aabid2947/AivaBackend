// src/services/aivaService.js
import { db } from '../config/firebaseAdmin.js'; // Ensure this path is correct for your ESM setup
import { generateGeminiText } from '../utils/geminiClient.js'; // Ensure this path is correct for your ESM setup
import { v4 as uuidv4 } from 'uuid';

export const AIVA_INITIAL_GREETING = "Hi there! I'm Aiva, your personal AI assistant. I'm here to simplify your day by helping with receiving and replying to phone calls, managing your emails, assisting with booking appointments, and even helping you remind about payments. What can I do for you today?";

export const ConversationStates = {
  AWAITING_USER_REQUEST: 'AWAITING_USER_REQUEST',
  AWAITING_INTENT_CONFIRMATION: 'AWAITING_INTENT_CONFIRMATION',
  AWAITING_AFFIRMATIVE_NEGATIVE: 'AWAITING_AFFIRMATIVE_NEGATIVE',
  PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT: 'PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT',
  PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_EXTRACT: 'PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_EXTRACT',
  AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT: 'AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT',
  CONVERSATION_ENDED_OR_COMPLETED_TASK: 'CONVERSATION_ENDED_OR_COMPLETED_TASK'
};

const IntentCategories = {
  MONITOR_EMAIL: 'MONITOR_EMAIL',
  PAYMENT_REMINDER: 'PAYMENT_REMINDER',
  APPOINTMENT_CALL: 'APPOINTMENT_CALL',
  MANAGE_CALLS: 'MANAGE_CALLS',
  NONE_OF_THE_ABOVE: 'NONE_OF_THE_ABOVE',
  OUT_OF_CONTEXT: 'OUT_OF_CONTEXT'
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

// Corrected service function to list user's chats
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
      return []; // Return empty array if no chats
    }

    const chats = [];
    snapshot.forEach(doc => {
      const data = doc.data();
      chats.push({
        id: doc.id, // or data.chatId, ensure consistency
        name: data.chatName || "Chat", // Fallback name
        createdAt: data.createdAt,
        updatedAt: data.updatedAt,
        // Optionally, add a snippet of the last message here for UI
        // This would require an additional query or denormalization.
      });
    });
    console.log(`aivaService: Found ${chats.length} chats for user ${userId}.`);
    return chats; // Return the array of chat objects
  } catch (error) {
    console.error(`aivaService: Error fetching chats for user ${userId}:`, error);
    throw error; // Re-throw the error to be handled by the controller
  }
}

// --- Modified Core Conversation Functions ---
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

// --- Main Service Logic ---
export async function handleUserMessage(userId, chatId, userMessageContent) {
  if (!db) throw new Error('Database not initialized.');
  if (!chatId) throw new Error('chatId is required to handle user message.');

  const conversationState = await getConversationState(userId, chatId);
  if (!conversationState) {
    console.error(`handleUserMessage: No conversation state found for userId ${userId}, chatId ${chatId}.`);
    return {
        aivaResponse: "Sorry, I couldn't find our current conversation. Please try starting a new chat.",
        currentState: null, chatId: chatId, userId: userId, error: "Conversation not found"
    };
  }

  await addMessageToHistory(userId, chatId, 'user', userMessageContent, conversationState.currentState);

  let aivaResponseContent = "I'm not sure how to respond to that right now.";
  let nextState = conversationState.currentState;
  let geminiPrompt = null;

  switch (conversationState.currentState) {
    case ConversationStates.AWAITING_USER_REQUEST:
    case ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT:
      geminiPrompt = getInitialIntentClassificationPrompt(userMessageContent);
      const classifiedIntentRaw = await generateGeminiText(geminiPrompt);
      console.log(`aivaService: Gemini intent classification raw response: "${classifiedIntentRaw}"`);
      const classifiedIntent = classifiedIntentRaw ? classifiedIntentRaw.trim().toUpperCase() : null;

      if (classifiedIntent && Object.values(IntentCategories).map(val => val.toUpperCase()).includes(classifiedIntent)) {
        if (classifiedIntent === IntentCategories.NONE_OF_THE_ABOVE || classifiedIntent === IntentCategories.OUT_OF_CONTEXT) {
          aivaResponseContent = "I see. I can primarily help with email monitoring, payment reminders, appointment calls, and managing phone calls. Is there something specific in these areas you need assistance with?";
          nextState = ConversationStates.AWAITING_USER_REQUEST;
          await updateConversationState(userId, chatId, nextState);
        } else {
          let intentSummary = `It sounds like you're looking for help with ${classifiedIntent.toLowerCase().replace(/_/g, ' ')}.`;
          if (classifiedIntent === IntentCategories.MONITOR_EMAIL) intentSummary = "It sounds like you'd like me to help with monitoring your emails.";
          else if (classifiedIntent === IntentCategories.PAYMENT_REMINDER) intentSummary = "It sounds like you want to set up a payment reminder.";
          else if (classifiedIntent === IntentCategories.APPOINTMENT_CALL) intentSummary = "It seems you're interested in making a phone call for an appointment.";
          else if (classifiedIntent === IntentCategories.MANAGE_CALLS) intentSummary = "It looks like you need assistance with managing phone calls.";
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
      geminiPrompt = getAffirmativeNegativeClassificationPrompt(userMessageContent, conversationState.lastProposedIntent);
      const confirmationResultRaw = await generateGeminiText(geminiPrompt);
      console.log(`aivaService: Gemini affirmative/negative raw response: "${confirmationResultRaw}" for proposed intent: ${conversationState.lastProposedIntent}`);
      const confirmationResult = confirmationResultRaw ? confirmationResultRaw.trim().toUpperCase() : null;

      if (confirmationResult === 'AFFIRMATIVE') {
        const confirmedIntent = conversationState.lastProposedIntent;
        if (confirmedIntent === IntentCategories.PAYMENT_REMINDER) {
          aivaResponseContent = "Great! To set up the payment reminder, I'll need a bit more information. What is the payment for, when do you need to be reminded, and is there a specific time?";
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        } else {
          aivaResponseContent = `Okay, we'll proceed with ${confirmedIntent.toLowerCase().replace(/_/g, ' ')}. (Path not fully implemented yet). What's the next step?`;
          nextState = ConversationStates.AWAITING_USER_REQUEST;
        }
        await updateConversationState(userId, chatId, nextState, { lastUserAffirmation: userMessageContent });
      } else if (confirmationResult === 'NEGATIVE') {
        aivaResponseContent = "My apologies for misunderstanding. Could you please tell me what you'd like to do then?";
        nextState = ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT;
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null });
      } else {
        aivaResponseContent = "Sorry, I didn't quite catch that. Was that a 'yes' or a 'no' regarding my previous question?";
        nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
      }
      break;

    case ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT:
      geminiPrompt = getPaymentDetailsExtractionPrompt(userMessageContent);
      const extractedDetailsRaw = await generateGeminiText(geminiPrompt);
      console.log(`aivaService: Gemini payment details extraction raw response: "${extractedDetailsRaw}"`);
      let extractedDetails = {};
      if (extractedDetailsRaw) {
          try {
              const cleanedJsonString = extractedDetailsRaw.replace(/^```json\s*|```\s*$/g, '');
              extractedDetails = JSON.parse(cleanedJsonString);
              console.log('aivaService: Parsed payment details:', extractedDetails);
          } catch (e) {
              console.error("aivaService: Failed to parse JSON from Gemini for payment details. Raw:", extractedDetailsRaw, "Error:", e.message);
          }
      }
      if (extractedDetails && (extractedDetails.task_description || extractedDetails.reminder_date)) {
        const reminderData = {
            userId, chatId,
            task: extractedDetails.task_description || "Not specified",
            date: extractedDetails.reminder_date || "Not specified",
            time: extractedDetails.reminder_time || 'any time',
            createdAt: new Date().toISOString(), status: 'pending'
        };
        console.log('aivaService: Processed reminder data for storage:', reminderData);
        let confirmationMsg = "Alright, I've set a reminder";
        if (reminderData.task !== "Not specified") { confirmationMsg += ` for "${reminderData.task}"`; }
        if (reminderData.date !== "Not specified") { confirmationMsg += ` on ${reminderData.date}`; }
        if (extractedDetails.reminder_time) { confirmationMsg += ` at ${extractedDetails.reminder_time}`; }
        confirmationMsg += (reminderData.task === "Not specified" && reminderData.date === "Not specified")
                         ? ". I couldn't get the task or date, though. Could you clarify?" : ".";
        if (reminderData.task === "Not specified" || reminderData.date === "Not specified") {
             aivaResponseContent = `${confirmationMsg} I missed some details. Can you provide the full task, date, and time again clearly?`;
             nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        } else {
            aivaResponseContent = `${confirmationMsg} Is there anything else I can help you with?`;
            nextState = ConversationStates.AWAITING_USER_REQUEST;
        }
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null, extractedPaymentDetailsPath: reminderData });
      } else {
        aivaResponseContent = "I couldn't quite get all the details for the reminder. Could you please tell me again: what is the payment for, and when do you need the reminder (date and optionally time)?";
        nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
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
    aivaResponse: aivaResponseContent, currentState: nextState,
    chatId: chatId, userId: userId
  };
}

// Ensure all functions you want to be available to the controller are exported
// If using CommonJS, this would be module.exports = { ... }
// For ES Modules, ensure each function is prefixed with 'export' or listed in an export statement.
// The functions createNewChat, deleteChat, getChatHistory, handleUserMessage, listUserChats
// AIVA_INITIAL_GREETING, and ConversationStates are already exported.
