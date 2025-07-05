// src/services/aiva/conversation.service.js
import { db } from '../../config/firebaseAdmin.js';
import { generateGeminiText } from '../../utils/geminiClient.js';
import { getChatHistory, addMessageToHistory } from './chatService.js';
import * as Prompts from './prompts.js';
import { ConversationStates, IntentCategories, ReplyTypes, EmailMonitoringPreferences } from './constants.js';

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
      const classifiedIntentRaw = await generateGeminiText(Prompts.getInitialIntentClassificationPrompt(userMessageContent));
      const classifiedIntent = classifiedIntentRaw ? classifiedIntentRaw.trim().toUpperCase() : null;
      
      console.log(`DEBUG: Classified Intent - ${classifiedIntent}`); // For debugging

      if (classifiedIntent === IntentCategories.CONVERSATIONAL_QUERY) {
        const chatHistory = await getChatHistory(userId, chatId, 10);
        aivaResponseContent = await generateGeminiText(Prompts.getContextualGuidancePrompt(chatHistory, "General assistance", userMessageContent));
        nextState = ConversationStates.AWAITING_USER_REQUEST;
      } else if (classifiedIntent && [IntentCategories.MONITOR_EMAIL, IntentCategories.SET_REMINDER, IntentCategories.APPOINTMENT_CALL, IntentCategories.SUMMARIZE_CONTENT].includes(classifiedIntent)) {
        let intentSummary = `It sounds like you want help with ${classifiedIntent.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
        aivaResponseContent = `${intentSummary}`;
        nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: classifiedIntent });
      } else {
        aivaResponseContent = "I see. I can primarily help with email monitoring, setting reminders, and managing calls. How can I assist you with one of these tasks?";
        nextState = ConversationStates.AWAITING_USER_REQUEST;
      }
      break;

    case ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE:
      const confirmationResultRaw = await generateGeminiText(Prompts.getAffirmativeNegativeClassificationPrompt(userMessageContent, conversationState.lastProposedIntent));
      const confirmationResult = confirmationResultRaw ? confirmationResultRaw.trim().toUpperCase() : 'UNCLEAR';
      
      if (confirmationResult === 'AFFIRMATIVE') {
        const confirmedIntent = conversationState.lastProposedIntent;
        
        // UPDATED: Changed to use the new, general reminder intent
        if (confirmedIntent === IntentCategories.SET_REMINDER) {
          aivaResponseContent = "Great! What should I remind you about?";
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
          await updateConversationState(userId, chatId, nextState, { reminderDetails: { task_description: null, reminder_date: null, reminder_time: null } });
        
        } else if (confirmedIntent === IntentCategories.APPOINTMENT_CALL) {
          aivaResponseContent = "Okay, I can help with that. To book the appointment, I'll need a few details. What is the full name and contact info (phone/email) of the person the appointment is for?";
          nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
          await updateConversationState(userId, chatId, nextState, { appointmentDetails: { patientName: null, patientContact: null, bookingContactNumber: null, reasonForAppointment: null, preferredCallTime: null } });
        
        } else if (confirmedIntent === IntentCategories.SUMMARIZE_CONTENT) {
            aivaResponseContent = "Excellent. Please provide the text or upload the file you want me to summarize.";
            nextState = ConversationStates.AWAITING_CONTENT_FOR_SUMMARY;
            await updateConversationState(userId, chatId, nextState);
        
        } else if (confirmedIntent === IntentCategories.MONITOR_EMAIL) {
            aivaResponseContent = "Okay, for email monitoring, would you like me to just notify you of important emails, or would you also like me to help draft replies to some of them?";
            nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES;
            await updateConversationState(userId, chatId, nextState);
        }

      } else {
        aivaResponseContent = "My apologies. Could you please clarify what you need help with?";
        nextState = ConversationStates.AWAITING_CLARIFICATION_FOR_NEGATIVE_INTENT;
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null });
      }
      break;

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
            const isoString = `${updatedReminderDetails.reminder_date}T${updatedReminderDetails.reminder_time}`;
            const reminderDateTime = new Date(isoString);

            if (isNaN(reminderDateTime.getTime())) {
                aivaResponseContent = "I had trouble understanding that date and time. Could you please provide it again? For example: 'tomorrow at 5pm'.";
                nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
                updatedReminderDetails.reminder_date = null;
                updatedReminderDetails.reminder_time = null;
                await updateConversationState(userId, chatId, nextState, { reminderDetails: updatedReminderDetails });
            } else {
                const reminderDataToStore = {
                    userId,
                    taskDescription: updatedReminderDetails.task_description,
                    reminderDateTime: reminderDateTime,
                    status: 'pending',
                    createdAt: new Date(),
                    chatId: chatId
                };
                const reminderRef = await db.collection('users').doc(userId).collection('paymentReminders').add(reminderDataToStore);
                aivaResponseContent = `Okay, I've set a reminder for "${reminderDataToStore.taskDescription}" on ${reminderDataToStore.reminderDateTime.toLocaleString()}. Is there anything else?`;
                nextState = ConversationStates.AWAITING_USER_REQUEST;
                await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null, reminderDetails: {}, lastReminderId: reminderRef.id });
            }
        } else {
            let followupQuestion = "Thanks. ";
            if (missingReminderDetails.includes('task_description')) {
                followupQuestion += "What should I remind you about?";
            } else if (missingReminderDetails.includes('reminder_date')) {
                followupQuestion += "What date should I set the reminder for?";
            } else if (missingReminderDetails.includes('reminder_time')) {
                followupQuestion += "And at what time?";
            }

            aivaResponseContent = followupQuestion.trim();
            nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
            await updateConversationState(userId, chatId, nextState, { reminderDetails: updatedReminderDetails });
        }
        break;

    // other cases...
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
