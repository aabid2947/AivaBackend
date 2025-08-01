
// src/services/aiva/prompts.js
import { ReplyTypes, IntentCategories, EmailMonitoringPreferences } from './constants.js';


/**
 * Creates a prompt to analyze the user's spoken response when asked to suggest an appointment time.
 * @param {string} transcribedText - The text transcribed from the user's speech.
 * @param {string} userName - The name of the person the appointment is for.
 * @param {string} reasonForAppointment - The reason for the appointment.
 * @returns {string} The generated prompt for the AI model.
 */
export function getAppointmentTimeSuggestionAnalysisPrompt(transcribedText, userName, reasonForAppointment) {
    return `You are an AI assistant analyzing a user's response in an automated phone call.
The call is on behalf of "${userName}" regarding "${reasonForAppointment}".
The user was asked: "What time would be best for the appointment?"
The user replied: "${transcribedText}"

Your task is to analyze this response and classify it into one of the following statuses, returning ONLY a single valid JSON object.

- **TIME_SUGGESTED**: The user proposed a specific date and/or time.
- **CANNOT_SCHEDULE**: The user explicitly states they cannot or do not want to schedule now.
- **QUESTION**: The user asks a question instead of providing a time.
- **UNCLEAR**: The response is too vague, ambiguous, or irrelevant to be acted upon.

Today's date is ${new Date().toDateString()}. The user is in the EAT (East Africa Time, UTC+3) timezone.

Based on the user's reply, return a JSON object with the following structure:
- If the status is 'TIME_SUGGESTED', include a "suggested_iso_string" with the full ISO 8601 date and time.
- If the status is 'CANNOT_SCHEDULE', include a "reason".
- If the status is 'QUESTION', include the "question".
- If the status is 'UNCLEAR', no other fields are needed.

Examples:
- User: "Yeah, how about tomorrow at 3 PM?" -> {"status": "TIME_SUGGESTED", "suggested_iso_string": "2025-07-29T15:00:00+03:00"}
- User: "I can't talk right now, I'm driving." -> {"status": "CANNOT_SCHEDULE", "reason": "User is driving."}
- User: "Is the clinic open on Saturdays?" -> {"status": "QUESTION", "question": "Is the clinic open on Saturdays?"}
- User: "I'm not sure." -> {"status": "UNCLEAR"}
- User: "The weather is nice today." -> {"status": "UNCLEAR"}

Return only the JSON object.`;
}


// --- NEW: A more advanced prompt for analyzing the final confirmation response ---
export function getConfirmationAnalysisPrompt(userReply) {
    return `You are analyzing the user's response to a confirmation question ("Is this correct?").
    The user's reply is: "${userReply}"

    Analyze the reply and return ONLY a JSON object with two keys:
    1. "confirmation_status": Classify the core sentiment as "AFFIRMATIVE", "NEGATIVE", or "UNCLEAR".
    2. "follow_up_question": If the user asks a follow-up question after their confirmation/negation, extract that question as a string. If there is no follow-up question, this value should be null.

    Examples:
    - User reply: "Yes, that's correct." -> {"confirmation_status": "AFFIRMATIVE", "follow_up_question": null}
    - User reply: "Yep, and can you tell me the number again?" -> {"confirmation_status": "AFFIRMATIVE", "follow_up_question": "Can you tell me the number again?"}
    - User reply: "No, that's wrong." -> {"confirmation_status": "NEGATIVE", "follow_up_question": null}
    - User reply: "I'm not sure" -> {"confirmation_status": "UNCLEAR", "follow_up_question": null}

    Return only the JSON object.`;
}

// --- NEW: A prompt to generate an answer to a follow-up question ---
export function getFollowUpQuestionAnswerPrompt(appointmentDetails, question) {
    return `You are a helpful AI assistant who has just confirmed an appointment. The user had a quick follow-up question. Provide a concise and direct answer.

    Here is the context you have:
    - Patient Name: ${appointmentDetails.userName}
    - Patient Contact: ${appointmentDetails.userContact || 'Not provided'}
    - Call-in Number for Clinic: ${appointmentDetails.bookingContactNumber}
    - Reason for Appointment: ${appointmentDetails.reasonForAppointment}
    - Special Instructions on file: ${appointmentDetails.extraDetails || 'None'}

    The user's follow-up question is: "${question}"

    Generate a helpful, brief answer to this question. For example, if they ask for "the number", provide the clinic's number.`;
}


export function getAppointmentDetailsExtractionPrompt(userMessage, existingDetails) {
  const detailsString = JSON.stringify(existingDetails, null, 2);
  return `An AI assistant is helping a user book an appointment. It needs to collect:
- "userName": The full name of the person for whom the appointment is.
- "userContact": The phone number of the patient. This is important so the clinic can contact them.
- "bookingContactNumber": The phone number of the clinic, office, or person to call. This number MUST be a valid phone number format.
- "reasonForAppointment": The reason for the appointment.
- "reminder_iso_string_with_offset": The full date and time for when the AI should MAKE THE CALL, as a single ISO 8601 string including the timezone offset. This is NOT the final appointment time.
- "extraDetails": Any other specific instructions or details for the booking (e.g., "ask for Dr. Smith", "mention it's for a follow-up"). This is optional.

The assistant has already collected some information:
${detailsString}

The user just sent a new message: "${userMessage}"

Analyze the new message to extract or update the details.
- **Validation Rule**: If the user provides a "bookingContactNumber" that is clearly not a valid phone number (e.g., has more than 15 digits, contains letters), set its value to "INVALID".
- Today's date is ${new Date().toDateString()}.
- The user is in the EAT (East Africa Time UTC+3 ) timezone.
- Convert their local time to a full ISO 8601 string WITH THE UTC OFFSET. For example, "July 5th at 6:45 PM" should become "2025-07-05T18:45:00+03:00".

Return a VALID JSON object containing all the details collected so far. If a detail is still missing, its value should be null.`;
}



// Other prompts remain unchanged
export function getPaymentDetailsExtractionPrompt(userMessage, existingDetails) {
  const detailsString = JSON.stringify(existingDetails, null, 2);
  return `An AI assistant is helping a user set a reminder. It needs to collect:
- "task_description": A brief description of what the reminder is for.
- "reminder_iso_string_with_offset": The full date and time for the reminder as a single ISO 8601 string including the timezone offset.

The assistant has already collected some information:
${detailsString}

The user just sent a new message: "${userMessage}"

Analyze the new message to extract or update the details.
- Today's date is ${new Date().toDateString()}.
- The user is in the EAT (East Africa Time UTC+3 ) timezone. When they say "6:45 PM", it means 18:45 in their local time.
- Convert their local time to a full ISO 8601 string WITH THE UTC OFFSET. For example, "July 5th at 6:45 PM" should become "2025-07-05T18:45:00+03:00".

Return a VALID JSON object containing all the details collected so far. If a detail is still missing, its value should be null.
Example Output:
{
  "task_description": "Pay college fees",
  "reminder_iso_string_with_offset": "2025-07-05T18:45:00+03:00"
}

Ensure the output is ONLY the JSON object.`;
}

// --- NEW PROMPT to get intent and details simultaneously ---
export function getInitialIntentAndDetailsExtractionPrompt(userMessage) {
  return `Analyze the user's message to determine their primary intent and extract any relevant details.
Return a single, valid JSON object with two keys: "intent" and "details".

The "intent" must be one of: ${Object.values(IntentCategories).join(', ')}.

The "details" object should correspond to the intent:
- If intent is "${IntentCategories.SET_REMINDER}", extract:
  - "task_description": A brief description of what the reminder is for.
  - "reminder_iso_string_with_offset": The full date and time for the reminder as an ISO 8601 string with timezone offset.
- If intent is "${IntentCategories.APPOINTMENT_CALL}", extract:
  - "userName": The full name of the person for the appointment.
  - "userContact": The phone number or email of the patient.
  - "bookingContactNumber": The phone number to call for booking.
  - "reasonForAppointment": The reason for the appointment.
  - "reminder_iso_string_with_offset": The suggested date/time for the call.

If a detail is not present in the message, its value should be null.
Today's date is ${new Date().toDateString()}. The user is in EAT (UTC+3:00).

User message: "${userMessage}"

Example for "remind me to pay college fees tomorrow at 5pm":
{
  "intent": "${IntentCategories.SET_REMINDER}",
  "details": {
    "task_description": "Pay college fees",
    "reminder_iso_string_with_offset": "2025-07-29T17:00:00+03:00" 
  }
}

Example for "hi":
{
  "intent": "${IntentCategories.CONVERSATIONAL_QUERY}",
  "details": {}
}

Ensure the output is ONLY the JSON object.`;
}

// --- NEW PROMPT to detect conversation closing remarks ---
export function getClosingRemarkClassificationPrompt(userMessage) {
  return `A user has just finished a task with an AI assistant. The assistant asked "Is there anything else?".
The user replied: "${userMessage}"
Does this reply mean the user is finished with the conversation (e.g., "no", "nothing", "that's all")?
Return only "CLOSING" or "NOT_CLOSING".`;
}


export function getSummarizationPrompt(textContent) {
  return `Please provide a concise summary and a "TL;DR" (Too Long; Didn't Read) version for the following text.

Text:
"""
${textContent}
"""

Format your response exactly as follows, with no extra text before or after:
Summary: [Your concise summary here]
TL;DR: [Your TL;DR here]`;
}

export function getVisionSummarizationPrompt() {
    return `Analyze the content of this image and provide a detailed description. Then, create a concise summary.
    Format your response exactly as follows:
    Description: [Your detailed description of the image content here]
    Summary: [Your concise summary here]`;
}

export function getReplyTypeClassificationPrompt(aivaQuestion, userReply) {
  return `An AI assistant, Aiva, asked a user a question to get a specific choice.
    Aiva's question: "${aivaQuestion}"
    User's reply: "${userReply}"
    Classify the user's reply into one of three categories:
    1. ${ReplyTypes.DIRECT_ANSWER}
    2. ${ReplyTypes.CONTEXTUAL_QUERY}
    3. ${ReplyTypes.UNRELATED}
    Return ONLY the classification label.`;
}

export function getContextualGuidancePrompt(chatHistory, aivaQuestion, userQuery) {
  const historyString = chatHistory.map(msg => `${msg.role}: ${msg.content}`).join('\n');
  return `You are Aiva, a helpful AI assistant. You asked the user a question to proceed with a task, but they replied with a contextual question of their own instead of a direct answer.
    Your Goal: Provide a helpful, smart response to the user's question, and then gently guide them back to answering your original question.
    Conversation History:
    ${historyString}
    Your Original Question to the User:
    "${aivaQuestion}"
    The User's Contextual Question:
    "${userQuery}"
    Generate a response that helps the user and encourages them to make a choice.`;
}

export function getInitialIntentClassificationPrompt(userMessage) {
  return `Analyze the user's message to determine their primary intent. Classify it into one of the following categories:
- **${IntentCategories.MONITOR_EMAIL}**: User wants help with managing, reading, or replying to emails.
- **${IntentCategories.SET_REMINDER}**: User wants to be reminded about something. This includes any kind of reminder, not just for payments.
- **${IntentCategories.APPOINTMENT_CALL}**: User wants the AI to make a phone call to book an appointment.
- **${IntentCategories.SUMMARIZE_CONTENT}**: User wants to summarize a text, file, or image.
- **${IntentCategories.CONVERSATIONAL_QUERY}**: A general question about Aiva's abilities, a greeting, or a conversational remark that doesn't fit other categories.
- **${IntentCategories.NONE_OF_THE_ABOVE}**: The user has a clear request, but it does not fall into any of the categories above.
- **${IntentCategories.OUT_OF_CONTEXT}**: The user's message is random, nonsensical, or completely unrelated to the assistant's purpose.
User message: "${userMessage}"
Return ONLY the intent label (e.g., "${IntentCategories.SET_REMINDER}").`;
}

export function getAffirmativeNegativeClassificationPrompt(userReply, proposedIntentSummary) {
  return `The user was previously asked to confirm if their intent was related to: "${proposedIntentSummary}".
User's reply: "${userReply}"
Is this reply affirmative (e.g., yes, confirm, correct) or negative (e.g., no, wrong, not that)?
Return "AFFIRMATIVE" or "NEGATIVE". If it's unclear, return "UNCLEAR".`;
}

export function getEmailMonitoringPreferenceClassificationPrompt(userMessage) {
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