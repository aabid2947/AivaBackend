// src/services/aivaService.js
// Main servive file for aiva chats
import { db } from '../config/firebaseAdmin.js';
import { generateGeminiText } from '../utils/geminiClient.js';
import { v4 as uuidv4 } from 'uuid';

export const AIVA_INITIAL_GREETING = "Hi there! I'm Aiva, your personal AI assistant. I'm here to simplify your day by helping with receiving and summarizing your files and text, managing your emails, assisting with booking appointments, and even helping you remind about payments. What can I do for you today?";

export const ConversationStates = {
  AWAITING_USER_REQUEST: 'AWAITING_USER_REQUEST',
  AWAITING_INTENT_CONFIRMATION: 'AWAITING_INTENT_CONFIRMATION',
  AWAITING_AFFIRMATIVE_NEGATIVE: 'AWAITING_AFFIRMATIVE_NEGATIVE',
  PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT: 'PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT',
  AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT: 'AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT',
  CONVERSATION_ENDED_OR_COMPLETED_TASK: 'CONVERSATION_ENDED_OR_COMPLETED_TASK',
  PROMPT_EMAIL_MONITORING_PREFERENCES: 'PROMPT_EMAIL_MONITORING_PREFERENCES',
  PROCESSING_EMAIL_MONITORING_PREFERENCES: 'PROCESSING_EMAIL_MONITORING_PREFERENCES',
  // New State for Summarization
  AWAITING_CONTENT_FOR_SUMMARY: 'AWAITING_CONTENT_FOR_SUMMARY',
};

const IntentCategories = {
  MONITOR_EMAIL: 'MONITOR_EMAIL',
  PAYMENT_REMINDER: 'PAYMENT_REMINDER',
  APPOINTMENT_CALL: 'APPOINTMENT_CALL',
  // Replaced MANAGE_CALLS with SUMMARIZE_CONTENT
  SUMMARIZE_CONTENT: 'SUMMARIZE_CONTENT',
  CONVERSATIONAL_QUERY: 'CONVERSATIONAL_QUERY',
  NONE_OF_THE_ABOVE: 'NONE_OF_THE_ABOVE',
  OUT_OF_CONTEXT: 'OUT_OF_CONTEXT'
};

// New classification for user replies within a state
const ReplyTypes = {
  DIRECT_ANSWER: 'DIRECT_ANSWER',
  CONTEXTUAL_QUERY: 'CONTEXTUAL_QUERY', // e.g., "which option is better for my business?"
  UNRELATED: 'UNRELATED'
};


const EmailMonitoringPreferences = {
  NOTIFY_ONLY: 'NOTIFY_ONLY',
  ASSIST_REPLY: 'ASSIST_REPLY',
  BOTH: 'BOTH',
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

// --- Chat Management Functions (createNewChat, deleteChat, listUserChats) ---
// These functions remain unchanged.
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

export async function addMessageToHistory(userId, chatId, role, content, stateWhenSent = null, intentContext = null) {
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

function getReplyTypeClassificationPrompt(aivaQuestion, userReply) {
  return `An AI assistant, Aiva, asked a user a question to get a specific choice.
    Aiva's question: "${aivaQuestion}"
    User's reply: "${userReply}"

    Classify the user's reply into one of three categories:
    1. ${ReplyTypes.DIRECT_ANSWER}: The user directly answers the question or provides one of the choices. (e.g., "notify only", "yes", "the second one").
    2. ${ReplyTypes.CONTEXTUAL_QUERY}: The user asks a follow-up question for clarification or provides context and asks for advice before making a choice. (e.g., "which one would be better for my business?", "what's the difference?").
    3. ${ReplyTypes.UNRELATED}: The user's reply is completely unrelated to the question and seems to change the subject.

    Return ONLY the classification label (e.g., "${ReplyTypes.DIRECT_ANSWER}").`;
}

function getContextualGuidancePrompt(chatHistory, aivaQuestion, userQuery) {
  const historyString = chatHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
  return `You are Aiva, a helpful AI assistant. You asked the user a question to proceed with a task, but they replied with a contextual question of their own instead of a direct answer.
    Your Goal: Provide a helpful, smart response to the user's question, and then gently guide them back to answering your original question.

    Conversation History:
    ${historyString}

    Your Original Question to the User:
    "${aivaQuestion}"

    The User's Contextual Question:
    "${userQuery}"

    Generate a response that helps the user and encourages them to make a choice. For example, if they describe their business, give them a recommendation and then ask them to confirm.`;
}


function getInitialIntentClassificationPrompt(userMessage) {
  return `User message: "${userMessage}"
Classify this message into one of the following intents:
1. ${IntentCategories.MONITOR_EMAIL}
2. ${IntentCategories.PAYMENT_REMINDER}
3. ${IntentCategories.APPOINTMENT_CALL}
4. ${IntentCategories.SUMMARIZE_CONTENT}
5. ${IntentCategories.CONVERSATIONAL_QUERY} (a general question about Aiva's abilities or a conversational remark)
6. ${IntentCategories.NONE_OF_THE_ABOVE}
7. ${IntentCategories.OUT_OF_CONTEXT}
Return ONLY the intent label.`;
}

// Other prompts (getAffirmativeNegativeClassificationPrompt, etc.) remain the same.
function getAffirmativeNegativeClassificationPrompt(userReply, proposedIntentSummary) {
  return `The user was previously asked to confirm if their intent was related to: "${proposedIntentSummary}".
User's reply: "${userReply}"
Is this reply affirmative (e.g., yes, confirm, correct, sounds good) or negative (e.g., no, wrong, not that, incorrect)?
Return "AFFIRMATIVE" or "NEGATIVE". If it's unclear or neither, return "UNCLEAR".`;
}



function getEmailMonitoringPreferenceClassificationPrompt(userMessage) {
  return `The user has confirmed they want help with email monitoring.
Aiva asked: "Okay, for email monitoring, would you like me to just notify you of important emails, or would you also like me to help draft replies to some of them?"
User's reply: "${userMessage}"

Classify this reply into one of the following preferences:
1. ${EmailMonitoringPreferences.NOTIFY_ONLY}
2. ${EmailMonitoringPreferences.ASSIST_REPLY}
3. ${EmailMonitoringPreferences.BOTH}
4. ${EmailMonitoringPreferences.UNCLEAR}
Return ONLY the preference label.`;
}

// New Prompt for Summarization
function getSummarizationPrompt(textContent) {
  return `Please provide a concise summary and a "TL;DR" (Too Long; Didn't Read) version for the following text.

Text:
"""
${textContent}
"""

Format your response exactly as follows, with no extra text before or after:
Summary: [Your concise summary here]
TL;DR: [Your TL;DR here]`;
}

// --- UPDATED: Smarter prompt for payment details ---
function getPaymentDetailsExtractionPrompt(userMessage) {
  return `The user wants to set a payment reminder. Extract the following information from their message:
    - "task_description": A brief description of what the reminder is for.
    - "reminder_date": The date in YYYY-MM-DD format.
    - "reminder_time": The time in 24-hour HH:MM:SS format.

    User's message: "${userMessage}"

    Analyze the message carefully. Today's date is ${new Date().toDateString()}. If the user says "tomorrow", calculate the correct date. Convert all times to a 24-hour format (e.g., 10:55 p.m. becomes 22:55:00).

    Return this information as a VALID JSON object. If a piece of information is not found, use null for its value.
    Example Input: "remind me about school fees tomorrow at 10:55 p.m."
    Example Output:
    {
      "task_description": "school fees",
      "reminder_date": "2025-06-27",
      "reminder_time": "22:55:00"
    }

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
      id: null,
      aivaResponse: "Sorry, I couldn't find our current conversation. Please try starting a new chat.",
      currentState: null, chatId: chatId, userId: userId, error: "Conversation not found"
    };
  }

  await addMessageToHistory(userId, chatId, 'user', userMessageContent, conversationState.currentState);

  let aivaResponseContent = "I'm not sure how to respond to that right now.";
  let nextState = conversationState.currentState;
  let additionalResponseParams = {};

  // Mid-conversation intent change logic remains the same.

  switch (conversationState.currentState) {
    case ConversationStates.AWAITING_USER_REQUEST:
    case ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT:
      // This logic remains the same
      const classifiedIntentRaw = await generateGeminiText(getInitialIntentClassificationPrompt(userMessageContent));
      const classifiedIntent = classifiedIntentRaw ? classifiedIntentRaw.trim().toUpperCase() : null;
      if (classifiedIntent === IntentCategories.CONVERSATIONAL_QUERY) {
        const chatHistory = await getChatHistory(userId, chatId, 10);
        aivaResponseContent = await generateGeminiText(getContextualGuidancePrompt(chatHistory, "General assistance", userMessageContent));
        nextState = ConversationStates.AWAITING_USER_REQUEST;
      } else if (classifiedIntent && [IntentCategories.MONITOR_EMAIL, IntentCategories.PAYMENT_REMINDER, IntentCategories.APPOINTMENT_CALL, IntentCategories.SUMMARIZE_CONTENT].includes(classifiedIntent)) {
        let intentSummary = `It sounds like you want help with ${classifiedIntent.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
        aivaResponseContent = `${intentSummary}`;
        nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: classifiedIntent });
      } else {
        aivaResponseContent = "I see. I can primarily help with email monitoring, payment reminders, and managing calls. How can I assist you with one of these tasks?";
        nextState = ConversationStates.AWAITING_USER_REQUEST;
      }
      break;

    case ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE:
      // This logic remains largely the same
      const confirmationResultRaw = await generateGeminiText(getAffirmativeNegativeClassificationPrompt(userMessageContent, conversationState.lastProposedIntent));
      const confirmationResult = confirmationResultRaw ? confirmationResultRaw.trim().toUpperCase() : 'UNCLEAR';
      if (confirmationResult === 'AFFIRMATIVE') {
        const confirmedIntent = conversationState.lastProposedIntent;
        if (confirmedIntent === IntentCategories.PAYMENT_REMINDER) {
          aivaResponseContent = "Great! What is the payment for, and when do you need to be reminded?";
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        } else if (confirmedIntent === IntentCategories.MONITOR_EMAIL) {
          aivaResponseContent = "Okay, for email monitoring, would you like me to just notify you of important emails, or would you also like me to help draft replies to some of them?";
          nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES;
        } else if (confirmedIntent === IntentCategories.SUMMARIZE_CONTENT) {
          aivaResponseContent = "Excellent. Please provide the text or upload the file you want me to summarize.";
          nextState = ConversationStates.AWAITING_CONTENT_FOR_SUMMARY;
        } else {
          aivaResponseContent = `Okay, we'll proceed with ${confirmedIntent.toLowerCase().replace(/_/g, ' ')}. (Path not fully implemented yet).`;
          nextState = ConversationStates.AWAITING_USER_REQUEST;
        }
        await updateConversationState(userId, chatId, nextState);
      } else {
        aivaResponseContent = "My apologies. Could you please clarify what you need help with?";
        nextState = ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT;
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null });
      }
      break;

    case ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES:
      const aivaQuestion = "Would you like me to just notify you of important emails, or would you also like me to help draft replies to some of them?";
      console.log(aivaQuestion)
      const replyTypeRaw = await generateGeminiText(getReplyTypeClassificationPrompt(aivaQuestion, userMessageContent));
      const replyType = replyTypeRaw ? replyTypeRaw.trim().toUpperCase() : ReplyTypes.CONTEXTUAL_QUERY;

      console.log(`aivaService: Reply type classified as: ${replyType}`);

      if (replyType === ReplyTypes.DIRECT_ANSWER) {
        // User gave a direct answer, proceed with existing logic
        const preferenceRaw = await generateGeminiText(getEmailMonitoringPreferenceClassificationPrompt(userMessageContent));
        const preference = preferenceRaw ? preferenceRaw.trim().toUpperCase() : EmailMonitoringPreferences.UNCLEAR;

        if ([EmailMonitoringPreferences.NOTIFY_ONLY, EmailMonitoringPreferences.ASSIST_REPLY, EmailMonitoringPreferences.BOTH].includes(preference)) {
          let preferenceForStorage = preference === EmailMonitoringPreferences.BOTH ? EmailMonitoringPreferences.ASSIST_REPLY : preference;
          let preferenceText = preferenceForStorage === EmailMonitoringPreferences.ASSIST_REPLY ? "notifying you and assisting with replies" : "just notifying you of important emails";

          aivaResponseContent = `Got it. I'll proceed with ${preferenceText}. To do this, I'll need access to your emails. Please follow the prompt from the application to connect your email account.`;
          additionalResponseParams.initiateOAuth = 'google_email';
          nextState = ConversationStates.AWAITING_USER_REQUEST;

          await db.collection('users').doc(userId).set({ settings: { emailMonitoringPreference: preferenceForStorage } }, { merge: true });
          await updateConversationState(userId, chatId, nextState, { emailMonitoringChatPreference: preferenceForStorage, lastProposedIntent: null });
        } else {
          aivaResponseContent = "Sorry, I didn't quite understand. Could you please specify 'notify only' or 'help reply'?";
          nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES; // Re-ask
        }
      } else if (replyType === ReplyTypes.CONTEXTUAL_QUERY) {
        // User asked a related question. Generate a smart response.
        console.log("Handling contextual query for email preferences...");
        const chatHistory = await getChatHistory(userId, chatId, 10);
        const guidancePrompt = getContextualGuidancePrompt(chatHistory, aivaQuestion, userMessageContent);
        aivaResponseContent = await generateGeminiText(guidancePrompt);
        nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES; // Remain in this state to await their choice
        // We don't update the state in the DB here, just return the helpful message
      } else { // UNRELATED
        // Handle unrelated tangent, maybe check for intent change or redirect.
        aivaResponseContent = "I see. Let's focus on the email monitoring first. Would you like me to just notify you, or also help with replies?";
        nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES; // Re-ask
      }
      break;


    case ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT:
      const extractedDetailsRaw = await generateGeminiText(getPaymentDetailsExtractionPrompt(userMessageContent));
      let extractedDetails = {};
      try {
        const cleanedJsonString = extractedDetailsRaw.replace(/^```json\s*|```\s*$/g, '');
        extractedDetails = JSON.parse(cleanedJsonString);
      } catch (e) {
        console.error("Failed to parse payment details JSON:", e, extractedDetailsRaw);
        extractedDetails = {}; // Reset on failure
      }

      // --- UPDATED: More robust date and time handling ---
      if (extractedDetails && extractedDetails.task_description && extractedDetails.reminder_date) {
        // Combine the extracted date and time into a full ISO string
        // If time is missing, default to a reasonable time like 09:00:00
        const timePart = extractedDetails.reminder_time || '09:00:00';
        const isoString = `${extractedDetails.reminder_date}T${timePart}`;
        const reminderDateTime = new Date(isoString);

        // Check if the resulting date is valid
        if (isNaN(reminderDateTime.getTime())) {
            console.error("Invalid date created:", isoString);
            aivaResponseContent = "I couldn't quite understand that date and time. Could you please provide it again? For example: 'tomorrow at 5pm' or 'July 25th at 9am'.";
            nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        } else {
            const reminderDataToStore = {
                userId,
                taskDescription: extractedDetails.task_description,
                reminderDateTime: reminderDateTime, // Store the valid Date object
                status: 'pending',
                createdAt: new Date(),
                chatId: chatId
            };
            const reminderRef = await db.collection('users').doc(userId).collection('paymentReminders').add(reminderDataToStore);
            aivaResponseContent = `Okay, I've set a reminder for "${reminderDataToStore.taskDescription}" on ${reminderDataToStore.reminderDateTime.toLocaleString()}. Is there anything else?`;
            nextState = ConversationStates.AWAITING_USER_REQUEST;
            await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null, lastReminderId: reminderRef.id });
        }
      } else {
        aivaResponseContent = "I missed some details. Could you please provide the full task, date, and time again clearly?";
        nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
      }
      break;
    
    default:
      console.warn(`Unhandled conversation state: ${conversationState.currentState}`);
      aivaResponseContent = "I seem to be a bit lost. Could we start over?";
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

// New function to handle the summarization task directly
export async function performSummarization(userId, chatId, textToSummarize) {
  if (!db) throw new Error('Database not initialized.');

  // 1. Add a placeholder message to history for the user's content
  await addMessageToHistory(userId, chatId, 'user', '[Content provided for summarization]', ConversationStates.AWAITING_CONTENT_FOR_SUMMARY);

  // 2. Generate the summary from Gemini
  const prompt = getSummarizationPrompt(textToSummarize);
  const summaryResponse = await generateGeminiText(prompt);

  // 3. Add Aiva's summary to the chat history
  const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', summaryResponse, ConversationStates.AWAITING_USER_REQUEST);

  // 4. Update the chat state back to awaiting a new request
  await updateConversationState(userId, chatId, ConversationStates.AWAITING_USER_REQUEST, { lastProposedIntent: null, lastAivaMessageId: aivaMessageRef.id });

  console.log(`aivaService: Summarization complete for chat ${chatId}.`);

  // 5. Return the response payload
  return {
    id: aivaMessageRef.id,
    aivaResponse: summaryResponse,
    currentState: ConversationStates.AWAITING_USER_REQUEST,
    chatId: chatId,
    userId: userId,
  };
}