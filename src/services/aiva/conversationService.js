// src/services/aiva/conversation.service.js
import { db } from '../../config/firebaseAdmin.js';
import { generateGeminiText } from '../../utils/geminiClient.js';
import { getChatHistory, addMessageToHistory } from './chatService.js';
import * as Prompts from './prompts.js';
import { ConversationStates, IntentCategories } from './constants.js';

export async function getConversationState(userId, chatId) {
  const chatRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId);
  const chatSnap = await chatRef.get();
  if (!chatSnap.exists) {
    console.warn(`conversation.service: Chat with ID ${chatId} not found for user ${userId}.`);
    return null;
  }
  return chatSnap.data();
}

export async function updateConversationState(userId, chatId, newState, updates = {}) {
  const chatRef = db.collection('users').doc(userId).collection('aivaChats').doc(chatId);
  const updatePayload = {
    currentState: newState,
    updatedAt: new Date().toISOString(),
    ...updates
  };
  await chatRef.update(updatePayload);
}

export async function handleUserMessage(userId, chatId, userMessageContent) {
  if (!db) throw new Error('Database not initialized.');
  if (!chatId) throw new Error('chatId is required.');

  const conversationState = await getConversationState(userId, chatId);
  if (!conversationState) {
    return {
      id: null, aivaResponse: "Sorry, I couldn't find our current conversation.", error: "Conversation not found"
    };
  }

  await addMessageToHistory(userId, chatId, 'user', userMessageContent, conversationState.currentState);

  let aivaResponseContent = "I'm not sure how to respond to that.";
  let nextState = conversationState.currentState;
  let additionalResponseParams = {};

  switch (conversationState.currentState) {
    case ConversationStates.AWAITING_USER_REQUEST:
    case ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT:
      // This logic remains the same
      break;

    case ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE:
      // This logic remains the same
      break;

    // --- UPDATED: Reminder processing logic ---
    case ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT:
        const existingReminderDetails = conversationState.reminderDetails || {};
        const extractedDetailsRaw = await generateGeminiText(Prompts.getPaymentDetailsExtractionPrompt(userMessageContent, existingReminderDetails));
        
        let updatedReminderDetails = {};
        try {
            const cleanedJsonString = extractedDetailsRaw.replace(/^```json\s*|```\s*$/g, '');
            updatedReminderDetails = JSON.parse(cleanedJsonString);
        } catch (e) {
            console.error("Failed to parse reminder details JSON:", e, extractedDetailsRaw);
            aivaResponseContent = "I'm having a little trouble understanding. Could you please rephrase that?";
            nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
            break;
        }

        const missingReminderDetails = Object.keys(updatedReminderDetails).filter(key => !updatedReminderDetails[key]);

        if (missingReminderDetails.length === 0) {
            // Now we have a full ISO string with offset, which creates a correct Date object
            const reminderDateTime = new Date(updatedReminderDetails.reminder_iso_string_with_offset);

            if (isNaN(reminderDateTime.getTime())) {
                aivaResponseContent = "I had trouble understanding that date and time. Could you please provide it again? For example: 'tomorrow at 5pm'.";
                nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
                // Clear the invalid detail to re-ask
                updatedReminderDetails.reminder_iso_string_with_offset = null;
                await updateConversationState(userId, chatId, nextState, { reminderDetails: updatedReminderDetails });
            } else {
                // Display the time in the user's local timezone for confirmation
                aivaResponseContent = `Okay, I have the following details for your reminder: For "${updatedReminderDetails.task_description}" on ${reminderDateTime.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}. Is this correct?`;
                nextState = ConversationStates.AWAITING_REMINDER_CONFIRMATION;
                await updateConversationState(userId, chatId, nextState, { reminderDetails: updatedReminderDetails });
            }
        } else {
            let followupQuestion = "Thanks. ";
            if (missingReminderDetails.includes('task_description')) {
                followupQuestion += "What should I remind you about?";
            } else if (missingReminderDetails.includes('reminder_iso_string_with_offset')) {
                followupQuestion += "And for what date and time?";
            }

            aivaResponseContent = followupQuestion.trim();
            nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
            await updateConversationState(userId, chatId, nextState, { reminderDetails: updatedReminderDetails });
        }
        break;

    case ConversationStates.AWAITING_REMINDER_CONFIRMATION:
        const reminderConfirmationRaw = await generateGeminiText(Prompts.getAffirmativeNegativeClassificationPrompt(userMessageContent, "the reminder details"));
        const reminderConfirmation = reminderConfirmationRaw ? reminderConfirmationRaw.trim().toUpperCase() : 'UNCLEAR';

        if (reminderConfirmation === 'AFFIRMATIVE') {
            const finalReminderDetails = conversationState.reminderDetails;
            // The Date object created from the full ISO string is now correct
            const reminderDateTime = new Date(finalReminderDetails.reminder_iso_string_with_offset);

            const reminderDataToStore = {
                userId,
                taskDescription: finalReminderDetails.task_description,
                reminderDateTime: reminderDateTime, // This is now the correct UTC time
                status: 'pending',
                createdAt: new Date(),
                chatId: chatId
            };
            const reminderRef = await db.collection('users').doc(userId).collection('paymentReminders').add(reminderDataToStore);
            aivaResponseContent = `Great! I've set the reminder for "${reminderDataToStore.taskDescription}". Is there anything else?`;
            nextState = ConversationStates.AWAITING_USER_REQUEST;
            await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null, reminderDetails: {}, lastReminderId: reminderRef.id });
        } else {
            aivaResponseContent = "My apologies. What would you like to change?";
            nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
            await updateConversationState(userId, chatId, nextState);
        }
        break;

    // Other cases remain the same...
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
