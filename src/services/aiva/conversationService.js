// src/services/aiva/conversation.service.js
import { db } from '../../config/firebaseAdmin.js';
import { generateGeminiText } from '../../utils/geminiClient.js';
import { getChatHistory, addMessageToHistory } from './chatService.js';
import * as Prompts from './prompts.js';
import { ConversationStates, IntentCategories, ReplyTypes, EmailMonitoringPreferences } from './constants.js';
import { convertToISOTime } from '../../../helper/convertDateToISO.js';

// Map of country names to their country codes (without '+')
const COUNTRY_CODE_MAP = {
  'Kenya': '254',
  'United States': '1',
  'India': '91',
  'United Kingdom': '44',
  'South Africa': '27',
  'Nigeria': '234',
  'Pakistan': '92',
  'Canada': '1',
  'Australia': '61',
  'Germany': '49',
  'France': '33',
  'Italy': '39',
  'Spain': '34',
  'Brazil': '55',
  'Russia': '7',
  'China': '86',
  'Japan': '81',
  'Turkey': '90',
  'Egypt': '20',
  'Ghana': '233',
  'Uganda': '256',
  'Tanzania': '255',
  'Ethiopia': '251',
  'Morocco': '212',
  'Saudi Arabia': '966',
  'UAE': '971',
  'Bangladesh': '880',
  'Indonesia': '62',
  'Mexico': '52',
  'Philippines': '63',
  // ...add more as needed
};

// Reverse map for quick lookup: code -> country
const COUNTRY_CODE_LOOKUP = Object.entries(COUNTRY_CODE_MAP).reduce((acc, [country, code]) => {
  acc[code] = country;
  return acc;
}, {});

/**
 * Checks if a phone number is valid based on country code and digit count.
 * @param {string} number - The phone number to validate (may start with '+').
 * @returns {{valid: boolean, message: string, country?: string, localNumber?: string, countryCode?: string}}
 */
export function validateInternationalPhoneNumber(number) {
  if (!number) return { valid: false, message: 'No number provided.' };
  let num = number.trim();
  if (num.startsWith('+')) num = num.slice(1);
  // Try 3, 2, then 1 digit country code
  for (let len = 3; len >= 1; len--) {
    const code = num.slice(0, len);
    if (COUNTRY_CODE_LOOKUP[code]) {
      const local = num.slice(len);
      if (/^\d{10}$/.test(local)) {
        return {
          valid: true,
          message: 'Valid number',
          country: COUNTRY_CODE_LOOKUP[code],
          localNumber: local,
          countryCode: code
        };
      } else {
        return {
          valid: false,
          message: `Number is not correct: after country code (${code}) should be 10 digits.`
        };
      }
    }
  }
  return {
    valid: false,
    message: 'Number is not correct: country code not recognized.'
  };
}

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
      if (conversationState.taskJustCompleted) {
        await updateConversationState(userId, chatId, nextState, { taskJustCompleted: false });
        const closingRemarkRaw = await generateGeminiText(Prompts.getClosingRemarkClassificationPrompt(userMessageContent));
        if (closingRemarkRaw && closingRemarkRaw.trim().toUpperCase() === 'CLOSING') {
          aivaResponseContent = "You're welcome! If you need anything else, just let me know.";
          nextState = ConversationStates.AWAITING_USER_REQUEST;
          break;
        }
      }

      const extractedDataRaw = await generateGeminiText(Prompts.getInitialIntentAndDetailsExtractionPrompt(userMessageContent));
      let intent, details;
      try {
        const cleanedJson = extractedDataRaw.replace(/^```json\s*|```\s*$/g, '');
        ({ intent, details } = JSON.parse(cleanedJson));
      } catch (error) {
        console.error("Failed to parse initial intent and details:", error, extractedDataRaw);
        intent = IntentCategories.CONVERSATIONAL_QUERY;
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
      } else if (intent === IntentCategories.APPOINTMENT_CALL) {
        if (details.userName && details.bookingContactNumber && details.reasonForAppointment && details.reminder_iso_string_with_offset) {
          const callDateTime = new Date(details.reminder_iso_string_with_offset);
          if (isNaN(callDateTime.getTime())) {
            aivaResponseContent = "I can help book that appointment, but I had trouble with the date and time provided. When should I make the call?";
            details.reminder_iso_string_with_offset = null;
            nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
            await updateConversationState(userId, chatId, nextState, { appointmentDetails: details });
          } else {
            aivaResponseContent = `Okay, I'm ready to book. Please confirm: For ${details.userName}, I will call ${details.bookingContactNumber} regarding "${details.reasonForAppointment}" at approximately ${callDateTime.toLocaleString('en-KE', { timeZone: 'Africa/Nairobi' })}. Is this correct?`;
            nextState = ConversationStates.AWAITING_APPOINTMENT_CONFIRMATION;
            await updateConversationState(userId, chatId, nextState, { appointmentDetails: details });
          }
        } else if (details && Object.values(details).some(v => v !== null)) {
          const appointmentFields = ['userName', 'bookingContactNumber', 'reasonForAppointment', 'reminder_iso_string_with_offset'];
          const missingApptDetails = appointmentFields.filter(key => !details[key]);
          let followupQuestion = "Okay, I can help book that appointment. ";
          if (missingApptDetails.includes('userName')) {
            followupQuestion += "What is the full name of the person this appointment is for?";
          } else if (missingApptDetails.includes('bookingContactNumber')) {
            followupQuestion += "What's the phone number I should call to book the appointment?";
          } else if (missingApptDetails.includes('reasonForAppointment')) {
            followupQuestion += "What is the reason for this appointment?";
          } else if (missingApptDetails.includes('reminder_iso_string_with_offset')) {
            followupQuestion += "And when would be a good time for me to make this call?";
          }
          aivaResponseContent = followupQuestion.trim();
          nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
          await updateConversationState(userId, chatId, nextState, { appointmentDetails: details });
        } else {
          aivaResponseContent = "It sounds like you want help with booking an appointment. Is that correct?";
          nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
          await updateConversationState(userId, chatId, nextState, { lastProposedIntent: intent });
        }
      } else if (intent && [IntentCategories.MONITOR_EMAIL, IntentCategories.SUMMARIZE_CONTENT].includes(intent)) {
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
          await updateConversationState(userId, chatId, nextState, { appointmentDetails: { userName: null, userContact: null, bookingContactNumber: null, reasonForAppointment: null, reminder_iso_string_with_offset: null, extraDetails: null } });

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
        const allowedEmailSwitches = [IntentCategories.SET_REMINDER, IntentCategories.APPOINTMENT_CALL, IntentCategories.SUMMARIZE_CONTENT];
        const emailSwitchPrompt = `The user is currently setting up email monitoring. Their latest message is: "${userMessageContent}". Does this message represent a clear request to switch to a different task (${allowedEmailSwitches.join(', ')})? Or is it related to the email setup? If it's a clear task switch, return the new intent label. Otherwise, return 'CONTINUE'.`;
        const newIntentRawFromEmail = await generateGeminiText(emailSwitchPrompt);
        const newIntentFromEmail = newIntentRawFromEmail ? newIntentRawFromEmail.trim().toUpperCase() : null;

      if (newIntentFromEmail && newIntentFromEmail !== 'CONTINUE' && allowedEmailSwitches.includes(newIntentFromEmail)) {
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
      } else {
        aivaResponseContent = "I see. Let's focus on the email monitoring first. Would you like me to just notify you, or also help with replies?";
        nextState = ConversationStates.PROMPT_EMAIL_MONITORING_PREFERENCES;
      }
      break;

    case ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT:
      const allowedReminderSwitches = [IntentCategories.MONITOR_EMAIL, IntentCategories.APPOINTMENT_CALL, IntentCategories.SUMMARIZE_CONTENT];
      const reminderSwitchPrompt = `The user is currently setting a reminder. Their latest message is: "${userMessageContent}". Does this message represent a clear request to switch to a different task (${allowedReminderSwitches.join(', ')})? Or is it a detail for the reminder? If it's a clear task switch, return the new intent label. Otherwise, return 'CONTINUE'.`;
      const newIntentRawFromReminder = await generateGeminiText(reminderSwitchPrompt);
      const newIntentFromReminder = newIntentRawFromReminder ? newIntentRawFromReminder.trim().toUpperCase() : null;

      if (newIntentFromReminder && newIntentFromReminder !== 'CONTINUE' && allowedReminderSwitches.includes(newIntentFromReminder)) {
          aivaResponseContent = `It sounds like you want to switch to a new task: ${newIntentFromReminder.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
          nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
          await updateConversationState(userId, chatId, nextState, { lastProposedIntent: newIntentFromReminder });
          break;
      }

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
        await updateConversationState(userId, chatId, nextState, { lastProposedIntent: null, reminderDetails: {}, lastReminderId: reminderRef.id, taskJustCompleted: true });
      } else {
        aivaResponseContent = "My apologies. What would you like to change?";
        nextState = ConversationStates.PROCESSING_PATH_PAYMENT_REMINDER_DETAILS_PROMPT;
        await updateConversationState(userId, chatId, nextState);
      }
      break;

    case ConversationStates.PROCESSING_APPOINTMENT_DETAILS:
      const allowedApptSwitches = [IntentCategories.MONITOR_EMAIL, IntentCategories.SET_REMINDER, IntentCategories.SUMMARIZE_CONTENT];
      const apptSwitchPrompt = `The user is currently scheduling an appointment. Their latest message is: "${userMessageContent}". Does this message represent a clear request to switch to a different task (${allowedApptSwitches.join(', ')})? Or is it likely a reply providing details for the appointment? If it's a clear switch, return the intent label (e.g., 'SET_REMINDER'). Otherwise, return 'CONTINUE'.`;
      const newIntentRawFromAppt = await generateGeminiText(apptSwitchPrompt);
      const newIntentFromAppt = newIntentRawFromAppt ? newIntentRawFromAppt.trim().toUpperCase() : null;

      if (newIntentRawFromAppt && newIntentFromAppt !== 'CONTINUE' && allowedApptSwitches.includes(newIntentFromAppt)) {
          aivaResponseContent = `It sounds like you want to switch to a new task: ${newIntentFromAppt.toLowerCase().replace(/_/g, ' ')}. Is that correct?`;
          nextState = ConversationStates.AWAITING_AFFIRMATIVE_NEGATIVE;
          await updateConversationState(userId, chatId, nextState, { lastProposedIntent: newIntentFromAppt });
          break;
      }

      const existingApptDetails = conversationState.appointmentDetails || {};
      
      // Check if this is a correction to existing details (if we already have some details)
      const hasExistingDetails = Object.keys(existingApptDetails).some(key => existingApptDetails[key] && key !== 'extraDetails');
      
      let extractedApptDetailsRaw;
      if (hasExistingDetails) {
        // Use correction prompt if we already have details
        extractedApptDetailsRaw = await generateGeminiText(Prompts.getAppointmentCorrectionPrompt(userMessageContent, existingApptDetails));
      } else {
        // Use initial extraction prompt for new details
        extractedApptDetailsRaw = await generateGeminiText(Prompts.getAppointmentDetailsExtractionPrompt(userMessageContent, existingApptDetails));
      }

      let updatedApptDetails = {};
      try {
        const cleanedJsonString = extractedApptDetailsRaw.replace(/^```json\s*|```\s*$/g, '');
        const extractedDetails = JSON.parse(cleanedJsonString);
        
        // Merge extracted details with existing details
        updatedApptDetails = { ...existingApptDetails, ...extractedDetails };
        
        // Apply our custom phone number validation instead of relying on Gemini
        if (updatedApptDetails.userContact && updatedApptDetails.userContact !== 'INVALID_FORMAT') {
          const userContactValidation = validateInternationalPhoneNumber(updatedApptDetails.userContact);
          if (!userContactValidation.valid) {
            updatedApptDetails.userContact = 'INVALID_FORMAT';
          }
        }
        
        if (updatedApptDetails.bookingContactNumber && updatedApptDetails.bookingContactNumber !== 'INVALID_FORMAT' && updatedApptDetails.bookingContactNumber !== 'SAME_AS_USER') {
          const bookingContactValidation = validateInternationalPhoneNumber(updatedApptDetails.bookingContactNumber);
          if (!bookingContactValidation.valid) {
            updatedApptDetails.bookingContactNumber = 'INVALID_FORMAT';
          }
        }
        
        // Check if both numbers are the same
        if (updatedApptDetails.userContact && updatedApptDetails.bookingContactNumber && 
            updatedApptDetails.userContact !== 'INVALID_FORMAT' && updatedApptDetails.bookingContactNumber !== 'INVALID_FORMAT' &&
            updatedApptDetails.userContact === updatedApptDetails.bookingContactNumber) {
          updatedApptDetails.bookingContactNumber = 'SAME_AS_USER';
        }
        
      } catch (e) {
        console.error("Failed to parse appointment details JSON:", e, extractedApptDetailsRaw);
        aivaResponseContent = "I'm having trouble understanding. Could you please rephrase that? I need clear information for the appointment booking.";
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        break;
      }

      // Handle phone number validation errors
      if (updatedApptDetails.bookingContactNumber === 'INVALID_FORMAT') {
        aivaResponseContent = "That doesn't seem to be a valid phone number for the clinic. Number is not correct: please provide a valid phone number with country code followed by exactly 10 digits (e.g., +254712345678 or +1234567890).";
        updatedApptDetails.bookingContactNumber = null;
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
        break;
      }

      if (updatedApptDetails.userContact === 'INVALID_FORMAT') {
        aivaResponseContent = "Number is not correct: please provide your phone number with country code followed by exactly 10 digits (e.g., +254712345678 or +1234567890).";
        updatedApptDetails.userContact = null;
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
        break;
      }

      if (updatedApptDetails.bookingContactNumber === 'SAME_AS_USER') {
        aivaResponseContent = "I notice you've provided the same number for both your contact and the clinic's number. I need the clinic's phone number to book the appointment. Could you please provide the correct clinic phone number?";
        updatedApptDetails.bookingContactNumber = null;
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
        break;
      }

      // Check for missing essential details and ask specifically
      const missingApptDetails = [];
      if (!updatedApptDetails.userName) missingApptDetails.push('userName');
      if (!updatedApptDetails.userContact) missingApptDetails.push('userContact');
      if (!updatedApptDetails.bookingContactNumber) missingApptDetails.push('bookingContactNumber');
      if (!updatedApptDetails.reasonForAppointment) missingApptDetails.push('reasonForAppointment');
      if (!updatedApptDetails.callTime) missingApptDetails.push('callTime');

      if (missingApptDetails.length === 0) {
        // All essential details collected, do final validation
        let validationErrors = [];
        
        // Final validation of phone numbers using our validation function
        if (updatedApptDetails.userContact) {
          const userContactValidation = validateInternationalPhoneNumber(updatedApptDetails.userContact);
          if (!userContactValidation.valid) {
            validationErrors.push(`Your phone number is not valid: ${userContactValidation.message}`);
          }
        }
        
        if (updatedApptDetails.bookingContactNumber) {
          const bookingContactValidation = validateInternationalPhoneNumber(updatedApptDetails.bookingContactNumber);
          if (!bookingContactValidation.valid) {
            validationErrors.push(`The clinic phone number is not valid: ${bookingContactValidation.message}`);
          }
        }
        
        // Validate phone numbers are different
        if (updatedApptDetails.userContact && updatedApptDetails.bookingContactNumber && 
            updatedApptDetails.userContact === updatedApptDetails.bookingContactNumber) {
          validationErrors.push("Your contact number and the clinic's number appear to be the same. Please provide the correct clinic phone number.");
        }
        
        // Validate name format (should have at least first and last name)
        if (updatedApptDetails.userName && !updatedApptDetails.userName.includes(' ')) {
          validationErrors.push("Please provide the full name (both first and last name) for the appointment.");
        }
        
        // Validate call time is in the future
        if (updatedApptDetails.callTime) {
          const callTime = new Date(updatedApptDetails.callTime);
          // Get current time in Kenya timezone
          const now = new Date();
          const kenyaNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
          
          if (callTime <= kenyaNow) {
            validationErrors.push("The call time should be in the future. Please provide a future date and time for when I should make the call.");
          }
        }
        
        if (validationErrors.length > 0) {
          aivaResponseContent = validationErrors.join(' ');
          nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
          // Reset the problematic fields
          if (updatedApptDetails.userContact === updatedApptDetails.bookingContactNumber) {
            updatedApptDetails.bookingContactNumber = null;
          }
          if (updatedApptDetails.userName && !updatedApptDetails.userName.includes(' ')) {
            updatedApptDetails.userName = null;
          }
          if (updatedApptDetails.callTime) {
            const callTime = new Date(updatedApptDetails.callTime);
            const now = new Date();
            const kenyaNow = new Date(now.toLocaleString('en-US', { timeZone: 'Africa/Nairobi' }));
            if (callTime <= kenyaNow) {
              updatedApptDetails.callTime = null;
            }
          }
          await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
        } else {
          // All validation passed, ask for extra details
          aivaResponseContent = "Perfect! I have all the essential details. Are there any special instructions I should mention when calling (like asking for a specific doctor, mentioning urgency, etc.)? If not, just say 'no' or 'none'.";
          nextState = ConversationStates.AWAITING_EXTRA_APPOINTMENT_DETAILS;
          await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
        }

      } else {
        // Ask for missing details in priority order
        let followupQuestion = "";
        
        if (missingApptDetails.includes('userName')) {
          followupQuestion = "What is the full name of the person this appointment is for? (Please provide both first and last name)";
        } else if (missingApptDetails.includes('userContact')) {
          followupQuestion = "What is your phone number? Please include the country code (e.g., +254712345678 for Kenya or +1234567890 for US).";
        } else if (missingApptDetails.includes('reasonForAppointment')) {
          followupQuestion = "What is the reason for this appointment? (e.g., 'dental checkup', 'eye examination', 'consultation')";
        } else if (missingApptDetails.includes('bookingContactNumber')) {
          followupQuestion = "What is the phone number of the clinic or office I should call to book this appointment? Please include the country code (e.g., +254701234567).";
        } else if (missingApptDetails.includes('callTime')) {
          followupQuestion = "When would be a good time for me to make this call to book the appointment? (e.g., 'tomorrow at 2 PM', 'Monday morning', 'this evening')";
        } else {
          followupQuestion = "I still need some more information. Can you please provide the missing details?";
        }

        aivaResponseContent = followupQuestion;
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        await updateConversationState(userId, chatId, nextState, { appointmentDetails: updatedApptDetails });
      }
      break;

    // --- CASE: Handle the collection of extra details ---
    case ConversationStates.AWAITING_EXTRA_APPOINTMENT_DETAILS:
      const finalApptDetailsFromState = conversationState.appointmentDetails;
      const isNegativeResponseRaw = await generateGeminiText(Prompts.getAffirmativeNegativeClassificationPrompt(userMessageContent, "providing extra details"));
      const isNegativeResponse = isNegativeResponseRaw ? isNegativeResponseRaw.trim().toUpperCase() : 'UNCLEAR';

      if (isNegativeResponse === 'NEGATIVE') {
        finalApptDetailsFromState.extraDetails = null;
      } else {
        finalApptDetailsFromState.extraDetails = userMessageContent;
      }

      // Convert callTime to proper format for confirmation
      const callDateTime = new Date(finalApptDetailsFromState.callTime);
      const formattedCallTime = callDateTime.toLocaleString('en-KE', { 
        timeZone: 'Africa/Nairobi',
        weekday: 'long',
        year: 'numeric',
        month: 'long', 
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      });

      let confirmationMessage = `Perfect! Let me confirm all the details:\n\n`;
      confirmationMessage += `👤 Patient Name: ${finalApptDetailsFromState.userName}\n`;
      confirmationMessage += `📱 Patient Contact: ${finalApptDetailsFromState.userContact}\n`;
      confirmationMessage += `🏥 Clinic Number: ${finalApptDetailsFromState.bookingContactNumber}\n`;
      confirmationMessage += `📋 Appointment Reason: ${finalApptDetailsFromState.reasonForAppointment}\n`;
      confirmationMessage += `⏰ I will call at: ${formattedCallTime}\n`;
      
      if (finalApptDetailsFromState.extraDetails) {
        confirmationMessage += `📝 Special Instructions: ${finalApptDetailsFromState.extraDetails}\n`;
      }
      
      confirmationMessage += `\nIs all of this information correct?`;

      aivaResponseContent = confirmationMessage;
      nextState = ConversationStates.AWAITING_APPOINTMENT_CONFIRMATION;
      await updateConversationState(userId, chatId, nextState, { appointmentDetails: finalApptDetailsFromState });
      break;

    case ConversationStates.AWAITING_APPOINTMENT_CONFIRMATION:
      const apptConfirmationRaw = await generateGeminiText(Prompts.getAffirmativeNegativeClassificationPrompt(userMessageContent, "the appointment details"));
      const apptConfirmation = apptConfirmationRaw ? apptConfirmationRaw.trim().toUpperCase() : 'UNCLEAR';

      if (apptConfirmation === 'AFFIRMATIVE') {
        const finalApptDetails = conversationState.appointmentDetails;
        const scheduleTime = new Date(finalApptDetails.callTime);

        // Prepare appointment data for storage (convert to legacy format for compatibility)
        const appointmentData = {
          userName: finalApptDetails.userName,
          userContact: finalApptDetails.userContact,
          bookingContactNumber: finalApptDetails.bookingContactNumber,
          reasonForAppointment: finalApptDetails.reasonForAppointment,
          reminder_iso_string_with_offset: finalApptDetails.callTime, // Legacy field name
          extraDetails: finalApptDetails.extraDetails,
          userId,
          chatId,
          status: 'pending',
          createdAt: new Date(),
          scheduleTime: scheduleTime,
        };

        const appointmentRef = await db.collection('users').doc(userId).collection('appointments').add(appointmentData);
        
        const successMessage = `Excellent! ✅ I have scheduled the appointment booking call for ${finalApptDetails.userName}. I will call ${finalApptDetails.bookingContactNumber} at the specified time to book the appointment regarding "${finalApptDetails.reasonForAppointment}". You'll receive a notification about the booking outcome.\n\nIs there anything else I can help you with?`;
        
        aivaResponseContent = successMessage;
        nextState = ConversationStates.AWAITING_USER_REQUEST;
        await updateConversationState(userId, chatId, nextState, { 
          lastProposedIntent: null, 
          appointmentDetails: {}, 
          lastAppointmentId: appointmentRef.id, 
          taskJustCompleted: true 
        });
        
      } else if (apptConfirmation === 'NEGATIVE') {
        aivaResponseContent = "No problem! What would you like to change? Please tell me which details need to be corrected and provide the correct information.";
        nextState = ConversationStates.PROCESSING_APPOINTMENT_DETAILS;
        // Keep existing details so user only has to correct specific items
        await updateConversationState(userId, chatId, nextState, { appointmentDetails: conversationState.appointmentDetails });
        
      } else {
        // UNCLEAR response
        aivaResponseContent = "I didn't quite catch that. To proceed with booking the appointment, please say 'yes' or 'confirm'. If you need to make changes, please say 'no' or 'change'.";
        nextState = ConversationStates.AWAITING_APPOINTMENT_CONFIRMATION;
        // Keep the same state and details
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