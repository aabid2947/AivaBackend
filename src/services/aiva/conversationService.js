// src/services/aiva/conversation.service.js
import { db } from '../../config/firebaseAdmin.js';
import { generateGeminiText } from '../../utils/geminiClient.js';
import { getChatHistory, addMessageToHistory } from './chatService.js';
import * as Prompts from './prompts.js';
import { ConversationStates, IntentCategories, ReplyTypes, EmailMonitoringPreferences } from './constants.js';
import { convertToISOTime } from '../../../helper/convertDateToISO.js';

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
      // UPDATED: Handle graceful closing of conversation
      if (conversationState.taskJustCompleted) {
        await updateConversationState(userId, chatId, nextState, { taskJustCompleted: false });
        const closingRemarkRaw = await generateGeminiText(Prompts.getClosingRemarkClassificationPrompt(userMessageContent));
        if (closingRemarkRaw && closingRemarkRaw.trim().toUpperCase() === 'CLOSING') {
          aivaResponseContent = "You're welcome! If you need anything else, just let me know.";
          nextState = ConversationStates.AWAITING_USER_REQUEST;
          break;
        }
      }

      // UPDATED: Use new prompt to get intent and details at once
      const extractedDataRaw = await generateGeminiText(Prompts.getInitialIntentAndDetailsExtractionPrompt(userMessageContent));
      let intent, details;
      try {
        const cleanedJson = extractedDataRaw.replace(/^```json\s*|```\s*$/g, '');
        ({ intent, details } = JSON.parse(cleanedJson));
      } catch (error) {
        console.error("Failed to parse initial intent and details:", error, extractedDataRaw);
        intent = IntentCategories.CONVERSATIONAL_QUERY; // Fallback
        details = {};
      }

      if (intent === IntentCategories.SET_REMINDER) {
        const { task_description, reminder_iso_string_with_offset } = details;
        if (task_description && reminder_iso_string_with_offset) {
          const reminderDateTime = new Date(reminder_iso_string_with_offset);
          aivaResponseContent = `Okay, I have the following details for your reminder: For "${task_description}" on ${reminderDateTime.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}. Is this correct?`;
          nextState = ConversationStates.AWAITING_REMINDER_CONFIRMATION;
          await updateConversationState(userId, chatId, nextState, { reminderDetails: details });
        } else if (task_description) {
          aivaResponseContent = `Okay, I can set a reminder for "${task_description}". When should I remind you?`;
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
          await updateConversationState(userId, chatId, nextState, { reminderDetails: details });
        } else {
          aivaResponseContent = "Great! What should I remind you about?";
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
          await updateConversationState(userId, chatId, nextState, { reminderDetails: { task_description: null, reminder_iso_string_with_offset: null } });
        }
      } else if (intent && [IntentCategories.MONITOR_EMAIL, IntentCategories.APPOINTMENT_CALL, IntentCategories.SUMMARIZE_CONTENT].includes(intent)) {
        let intentSummary = `It sounds like you want help with ${intent.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
        aivaResponseContent = `${intentSummary}`;
        nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: intent });
      } else if (intent === IntentCategories.CONVERSATIONAL_QUERY) {
        const chatHistory = await getChatHistory(userId, chatId, 10);
        aivaResponseContent = await generateGeminiText(Prompts.getContextualGuidancePrompt(chatHistory, "General assistance", userMessageContent));
        nextState = ConversationStates.AWAITING_USER_REQUEST;
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

        if (confirmedIntent === IntentCategories.SET_REMINDER) {
          aivaResponseContent = "Great! What should I remind you about?";
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
          await updateConversationState(userId, chatId, nextState, { reminderDetails: { task_description: null, reminder_iso_string_with_offset: null } });

        } else if (confirmedIntent === IntentCategories.APPOINTMENT_CALL) {
          aivaResponseContent = "Okay, I can help with that. To book the appointment, I'll need a few details. What is the full name and contact info (phone/email) of the person the appointment is for?";
          nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
          await updateConversationState(userId, chatId, nextState, { appointmentDetails: { userName: null, userContact: null, bookingContactNumber: null, reasonForAppointment: null, preferredCallTime: null } });

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

    case ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES:
      // UPDATED: Added pre-emptive check for task switching
      const newIntentRawFromEmail = await generateGeminiText(Prompts.getInitialIntentClassificationPrompt(userMessageContent));
      const newIntentFromEmail = newIntentRawFromEmail ? newIntentRawFromEmail.trim().toUpperCase() : null;

      if (newIntentFromEmail && newIntentFromEmail !== IntentCategories.MONITOR_EMAIL && [IntentCategories.SET_REMINDER, IntentCategories.APPOINTMENT_CALL, IntentCategories.SUMMARIZE_CONTENT].includes(newIntentFromEmail)) {
        aivaResponseContent = `It sounds like you want to switch to a new task: ${newIntentFromEmail.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
        nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: newIntentFromEmail });
        break;
      }
      
      const aivaQuestion = "Would you like me to just notify you of important emails, or would you also like me to help draft replies to some of them?";
      const replyTypeRaw = await generateGeminiText(Prompts.getReplyTypeClassificationPrompt(aivaQuestion, userMessageContent));
      const replyType = replyTypeRaw ? replyTypeRaw.trim().toUpperCase() : ReplyTypes.CONTEXTUAL_QUERY;

      if (replyType === ReplyTypes.DIRECT_ANSWER) {
        const preferenceRaw = await generateGeminiText(Prompts.getEmailMonitoringPreferenceClassificationPrompt(userMessageContent));
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
          nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES;
        }
      } else if (replyType === ReplyTypes.CONTEXTUAL_QUERY) {
        const chatHistory = await getChatHistory(userId, chatId, 10);
        const guidancePrompt = Prompts.getContextualGuidancePrompt(chatHistory, aivaQuestion, userMessageContent);
        aivaResponseContent = await generateGeminiText(guidancePrompt);
        nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES;
      } else { // UNRELATED or task switch attempt was already handled
        aivaResponseContent = "I see. Let's focus on the email monitoring first. Would you like me to just notify you, or also help with replies?";
        nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES;
      }
      break;

    case ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT:
      // UPDATED: Pre-emptive check for task switching
      const newIntentRawFromReminder = await generateGeminiText(Prompts.getInitialIntentClassificationPrompt(userMessageContent));
      const newIntentFromReminder = newIntentRawFromReminder ? newIntentRawFromReminder.trim().toUpperCase() : null;
      if (newIntentFromReminder && newIntentFromReminder !== IntentCategories.SET_REMINDER && [IntentCategories.MONITOR_EMAIL, IntentCategories.APPOINTMENT_CALL, IntentCategories.SUMMARIZE_CONTENT].includes(newIntentFromReminder)) {
          aivaResponseContent = `It sounds like you want to switch to a new task: ${newIntentFromReminder.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
          nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
          await updateConversationState(userId, chatId, nextState, { lastProposedIntent: newIntentFromReminder });
          break;
      }

      // If not switching, proceed with detail extraction
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
        const reminderDateTime = new Date(updatedReminderDetails.reminder_iso_string_with_offset);

        if (isNaN(reminderDateTime.getTime())) {
          aivaResponseContent = "I had trouble understanding that date and time. Could you please provide it again? For example: 'tomorrow at 5pm'.";
          nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
          updatedReminderDetails.reminder_iso_string_with_offset = null;
          await updateConversationState(userId, chatId, nextState, { reminderDetails: updatedReminderDetails });
        } else {
          aivaResponseContent = `Okay, I have the following details for your reminder: For "${updatedReminderDetails.task_description}" on ${reminderDateTime.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}. Is this correct?`;
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
        const reminderDateTime = new Date(finalReminderDetails.reminder_iso_string_with_offset);

        const reminderDataToStore = {
          userId,
          taskDescription: finalReminderDetails.task_description,
          reminderDateTime: reminderDateTime,
          status: 'pending',
          createdAt: new Date(),
          chatId: chatId
        };
        const reminderRef = await db.collection('users').doc(userId).collection('paymentReminders').add(reminderDataToStore);
        aivaResponseContent = `Great! I've set the reminder for "${reminderDataToStore.taskDescription}". Is there anything else?`;
        nextState = ConversationStates.AWAITING_USER_REQUEST;
        // UPDATED: Set flag for graceful closing
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null, reminderDetails: {}, lastReminderId: reminderRef.id, taskJustCompleted: true });
      } else {
        aivaResponseContent = "My apologies. What would you like to change?";
        nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        await updateConversationState(userId, chatId, nextState);
      }
      break;

    case ConversationStates.PROCESSING_APPOINTMENT_DETAILS:
      // UPDATED: Pre-emptive check for task switching
      const newIntentRawFromAppt = await generateGeminiText(Prompts.getInitialIntentClassificationPrompt(userMessageContent));
      const newIntentFromAppt = newIntentRawFromAppt ? newIntentRawFromAppt.trim().toUpperCase() : null;
      if (newIntentFromAppt && newIntentFromAppt !== IntentCategories.APPOINTMENT_CALL && [IntentCategories.MONITOR_EMAIL, IntentCategories.SET_REMINDER, IntentCategories.SUMMARIZE_CONTENT].includes(newIntentFromAppt)) {
          aivaResponseContent = `It sounds like you want to switch to a new task: ${newIntentFromAppt.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
          nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
          await updateConversationState(userId, chatId, nextState, { lastProposedIntent: newIntentFromAppt });
          break;
      }

      const existingApptDetails = conversationState.appointmentDetails || {};
      const extractedApptDetailsRaw = await generateGeminiText(Prompts.getAppointmentDetailsExtractionPrompt(userMessageContent, existingApptDetails));

      let updatedApptDetails = {};
      try {
        const cleanedJsonString = extractedApptDetailsRaw.replace(/^```json\s*|```\s*$/g, '');
        updatedApptDetails = JSON.parse(cleanedJsonString);
      } catch (e) {
        console.error("Failed to parse appointment details JSON:", e, extractedApptDetailsRaw);
        aivaResponseContent = "I'm having a little trouble understanding. Could you please rephrase that?";
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        break;
      }

      if (updatedApptDetails.bookingContactNumber === 'INVALID') {
        aivaResponseContent = "That doesn't seem to be a valid phone number. Please provide a correct phone number, including the country code if necessary.";
        updatedApptDetails.bookingContactNumber = null;
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
        break;
      }

      const missingApptDetails = Object.keys(updatedApptDetails).filter(key => !updatedApptDetails[key]);

      if (missingApptDetails.length === 0) {
        const callDateTime = new Date(updatedApptDetails.reminder_iso_string_with_offset);
        if (isNaN(callDateTime.getTime())) {
          aivaResponseContent = "I had trouble understanding that date and time for the call. Could you please provide it again?";
          nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
          updatedApptDetails.reminder_iso_string_with_offset = null;
          await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
        } else {
          aivaResponseContent = `Okay, I'm ready to book. Please confirm: For ${updatedApptDetails.userName}, I will call ${updatedApptDetails.bookingContactNumber} regarding "${updatedApptDetails.reasonForAppointment}" at approximately ${callDateTime.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}. Is this correct?`;
          nextState = ConversationStates.AWAITING_APPOINTMENT_CONFIRMATION;
          await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
        }
      } else {
        let followupQuestion = "Thanks! ";
        if (missingApptDetails.includes('userName')) {
          followupQuestion += "What is the full name of the person this appointment is for?";
        } else if (missingApptDetails.includes('userContact')) {
          followupQuestion += "What is the user's contact number or email?";
        } else if (missingApptDetails.includes('bookingContactNumber')) {
          followupQuestion += "What's the phone number I should call to book the appointment? Please include the country code.";
        } else if (missingApptDetails.includes('reasonForAppointment')) {
          followupQuestion += "What is the reason for this appointment?";
        } else if (missingApptDetails.includes('reminder_iso_string_with_offset')) {
          followupQuestion += "And when would be a good time for me to make this call?";
        } else {
          followupQuestion = "I still need a little more information. Can you please provide the remaining details?";
        }

        aivaResponseContent = followupQuestion.trim();
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
      }
      break;

    case ConversationStates.AWAITING_APPOINTMENT_CONFIRMATION:
      const apptConfirmationRaw = await generateGeminiText(Prompts.getAffirmativeNegativeClassificationPrompt(userMessageContent, "the appointment details"));
      const apptConfirmation = apptConfirmationRaw ? apptConfirmationRaw.trim().toUpperCase() : 'UNCLEAR';

      if (apptConfirmation === 'AFFIRMATIVE') {
        const finalApptDetails = conversationState.appointmentDetails;
        const scheduleTime = new Date(finalApptDetails.reminder_iso_string_with_offset);

        const appointmentData = {
          ...finalApptDetails,
          userId,
          chatId,
          status: 'pending',
          createdAt: new Date(),
          scheduleTime: scheduleTime,
        };
        const appointmentRef = await db.collection('users').doc(userId).collection('appointments').add(appointmentData);
        aivaResponseContent = `Great, I have all the details. I will make the call around the preferred time to book the appointment for ${finalApptDetails.userName}. I'll let you know how it goes. Is there anything else?`;
        nextState = ConversationStates.AWAITING_USER_REQUEST;
        // UPDATED: Set flag for graceful closing
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null, appointmentDetails: {}, lastAppointmentId: appointmentRef.id, taskJustCompleted: true });
      } else {
        aivaResponseContent = "My apologies. What would you like to change?";
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        await updateConversationState(userId, chatId, nextState);
      }
      break;
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