// src/services/aiva/prompts.js
import { ReplyTypes, IntentCategories, EmailMonitoringPreferences } from './constants.js';

// --- UPDATED: This prompt now requests a full ISO string with the UTC offset ---
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
- The user is in the IST (India Standard Time, UTC+5:30) timezone. When they say "6:45 PM", it means 18:45 in their local time.
- Convert their local time to a full ISO 8601 string WITH THE UTC OFFSET. For example, "July 5th at 6:45 PM" should become "2025-07-05T18:45:00+05:30".

Return a VALID JSON object containing all the details collected so far. If a detail is still missing, its value should be null.
Example Output:
{
  "task_description": "Pay college fees",
  "reminder_iso_string_with_offset": "2025-07-05T18:45:00+05:30"
}

Ensure the output is ONLY the JSON object.`;
}

// Other prompts remain unchanged
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

export function getAppointmentDetailsExtractionPrompt(userMessage, existingDetails) {
  const detailsString = JSON.stringify(existingDetails, null, 2);
  return `An AI assistant is helping a user book an appointment. It needs: "patientName", "patientContact", "bookingContactNumber", "reasonForAppointment", "preferredCallTime".
The assistant has already collected:
${detailsString}
The user just sent a new message: "${userMessage}"
Analyze the new message and update the collected information. Return a VALID JSON object containing all details collected so far. If a detail is still missing, its value should be null. Today's date is ${new Date().toDateString()}.
Ensure the output is ONLY the JSON object.`;
}
