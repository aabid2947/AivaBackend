// src/services/aiva/prompts.js
import { ReplyTypes, IntentCategories, EmailMonitoringPreferences } from './constants.js';

// --- UPDATED: Improved the initial intent classification prompt ---
export function getInitialIntentClassificationPrompt(userMessage) {
  return `Analyze the user's message to determine their primary intent. Classify it into one of the following categories:

- **${IntentCategories.MONITOR_EMAIL}**: User wants help with managing, reading, or replying to emails.
  (Examples: "check my emails", "can you handle my inbox?", "reply to the latest message from John")

- **${IntentCategories.SET_REMINDER}**: User wants to be reminded about something. This includes any kind of reminder, not just for payments.
  (Examples: "set a reminder", "remind me to call the doctor", "don't let me forget the meeting tomorrow at 10")

- **${IntentCategories.APPOINTMENT_CALL}**: User wants the AI to make a phone call to book an appointment.
  (Examples: "book a dentist appointment", "can you call my mechanic?", "schedule a haircut for me")

- **${IntentCategories.SUMMARIZE_CONTENT}**: User wants to summarize a text, file, or image.
  (Examples: "summarize this for me", "give me the TL;DR", "what does this document say?")

- **${IntentCategories.CONVERSATIONAL_QUERY}**: A general question about Aiva's abilities, a greeting, or a conversational remark that doesn't fit other categories.
  (Examples: "hi", "what can you do?", "that's cool")

- **${IntentCategories.NONE_OF_THE_ABOVE}**: The user has a clear request, but it does not fall into any of the categories above.

- **${IntentCategories.OUT_OF_CONTEXT}**: The user's message is random, nonsensical, or completely unrelated to the assistant's purpose.

User message: "${userMessage}"

Return ONLY the intent label (e.g., "${IntentCategories.SET_REMINDER}").`;
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

export function getPaymentDetailsExtractionPrompt(userMessage, existingDetails) {
  const detailsString = JSON.stringify(existingDetails, null, 2);
  return `An AI assistant is helping a user set a payment reminder. It needs to collect:
- "task_description": A brief description of what the reminder is for.
- "reminder_date": The date for the reminder in YYYY-MM-DD format.
- "reminder_time": The time for the reminder in 24-hour HH:MM:SS format.

The assistant has already collected some information:
${detailsString}

The user just sent a new message: "${userMessage}"

Analyze the new message and update the collected information. Today's date is ${new Date().toDateString()}.
- If the user says "tomorrow", calculate the correct date.
- Convert all times to a 24-hour format (e.g., 10:55 p.m. becomes 22:55:00).
- If a detail is still missing, its value should be null.

Return a VALID JSON object containing all the details collected so far.
Example Output:
{
  "task_description": "hospital bill",
  "reminder_date": "2025-07-06",
  "reminder_time": "15:10:00"
}

Ensure the output is ONLY the JSON object.`;
}

// Other prompts remain unchanged...
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
