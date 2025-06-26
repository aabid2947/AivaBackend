// src/services/gmailService.js
// This file works with a cron job to monitor and intelligently handle emails.
import { google } from 'googleapis';
import { db, admin } from '../config/firebaseAdmin.js';
import { generateGeminiText } from '../utils/geminiClient.js';
import { getUserGoogleTokens } from './googleTokenService.js';
import { decode } from 'js-base64';

// --- Helper to get an authenticated OAuth2 client ---
async function getAuthenticatedOAuth2Client(userId) {
  const tokenData = await getUserGoogleTokens(userId);
  if (!tokenData || !tokenData.accessToken) {
    console.error(`gmailService_DEBUG: For user ${userId}, no token data was found.`);
    return null;
  }
  const oauth2Client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET);
  oauth2Client.setCredentials({ access_token: tokenData.accessToken, refresh_token: tokenData.refreshToken });
  return oauth2Client;
}

// --- FCM Notification Sender ---
async function sendImportantEmailNotification(userId, emailSubject) {
  try {
    const userDoc = await db.collection('users').doc(userId).get();
    if (!userDoc.exists || !userDoc.data().fcmToken) {
      console.warn(`User ${userId} does not have an FCM token. Skipping important email notification.`);
      return;
    }
    const fcmToken = userDoc.data().fcmToken;
    const message = {
      notification: { title: 'Important Email Received', body: emailSubject },
      token: fcmToken,
      data: { type: 'important_email', subject: emailSubject }
    };
    await admin.messaging().send(message);
    console.log(`Successfully sent 'Important Email' notification to user ${userId}.`);
  } catch (error) {
    console.error(`Failed to send FCM notification for user ${userId}:`, error);
  }
}

// --- Email Classification (Simplified) ---
const EmailCategories = {
  IMPORTANT: 'IMPORTANT',
  NON_IMPORTANT: 'NON_IMPORTANT',
};

async function classifyEmail(emailContent) {
  const { subject, from, bodySnippet } = emailContent;
  const prompt = `Analyze the following email and classify it as either IMPORTANT or NON_IMPORTANT.

    - **IMPORTANT**:
        - Job Offers (e.g., "Your job offer from...", "Congratulations on your offer")
        - Payment Due Reminders (e.g., "Your bill is due", "Upcoming payment for...")
        - Personal Messages from known contacts (e.g., casual conversation from a person, not a company)
    - **NON_IMPORTANT**:
        - Newsletters, promotions, marketing emails
        - Transactional emails (e.g., receipts, shipping updates)
        - General notifications from services

    From: ${from}
    Subject: ${subject}
    Body Snippet: ${bodySnippet.substring(0, 500)}

    Return ONLY the category label (IMPORTANT or NON_IMPORTANT).`;

  try {
    const classification = await generateGeminiText(prompt);
    return classification?.trim() === EmailCategories.IMPORTANT ? EmailCategories.IMPORTANT : EmailCategories.NON_IMPORTANT;
  } catch (error) {
    console.error('gmailService: Error classifying email:', error);
    return EmailCategories.NON_IMPORTANT; // Default to non-important on error
  }
}

// --- Reply Generation for Important Emails ---
async function generateReplyForImportantEmail(emailContent) {
  const { subject, from, bodySnippet } = emailContent;
  const prompt = `You are Aiva, an AI assistant. The user received an IMPORTANT email. Draft a polite and professional reply based on its likely content.

    - If it seems like a **job offer**, express gratitude and excitement, and state that the user will review the details and respond shortly.
    - If it's a **payment reminder**, acknowledge the reminder and politely state that it will be taken care of.
    - If it's a **personal message**, draft a warm and friendly acknowledgment, mentioning you'll pass the message along.

    From: ${from}
    Subject: ${subject}
    Snippet: ${bodySnippet}

    Your drafted reply:`;

  try {
    const reply = await generateGeminiText(prompt);
    return reply ? reply.trim() : null;
  } catch (error) {
    console.error('gmailService: Error generating reply:', error);
    return null;
  }
}

// --- NEW: Summary Generation for Notifications ---
async function generateSummaryForNotification(bodySnippet) {
    const prompt = `Summarize the following text in under 15 words to be used in a push notification.
    
    Text: "${bodySnippet}"
    
    Summary:`;
    try {
        const summary = await generateGeminiText(prompt);
        return summary ? summary.trim() : 'Important email received with no subject.';
    } catch (error) {
        console.error('gmailService: Error generating summary for notification:', error);
        return 'Important email received with no subject.';
    }
}


/**
 * Sends a reply to an email.
 * @param {object} gmail - The authenticated Gmail API client.
 * @param {object} email - The original email object.
 * @param {string} replyText - The text of the reply.
 */
async function sendReply(gmail, email, replyText) {
    const originalSubject = email.subject.startsWith("Re: ") ? email.subject : `Re: ${email.subject}`;
    const rawMessage = [
        `To: ${email.from}`,
        `Subject: ${originalSubject}`,
        `In-Reply-To: ${email.messageIdHeader}`,
        `References: ${email.messageIdHeader}`,
        'Content-Type: text/plain; charset="UTF-8"',
        'MIME-Version: 1.0',
        '',
        replyText
    ].join('\n');
    const encodedMessage = Buffer.from(rawMessage).toString('base64url');
    await gmail.users.messages.send({
        userId: 'me',
        requestBody: {
            raw: encodedMessage,
            threadId: email.threadId
        },
    });
    console.log(`Reply sent successfully to ${email.from}`);
}

// --- ADDED BACK: Function to get users with email monitoring enabled ---
export async function getUsersWithEmailMonitoringEnabled() {
  const usersRef = db.collection('users');
  const snapshot = await usersRef.where('settings.isGoogleMailIntegrated', '==', true).get();
  if (snapshot.empty) {
    console.log('Scheduler: No users found with email monitoring enabled.');
    return [];
  }
  const userIds = snapshot.docs.map(doc => doc.id);
  return userIds;
}


// --- Main Email Processing Logic ---
export async function checkAndProcessUserEmails(userId, fallbackIntervalMinutes) {
  const oauth2Client = await getAuthenticatedOAuth2Client(userId);
  if (!oauth2Client) return;

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const userDocRef = db.collection('users').doc(userId);

  try {
    const userDoc = await userDocRef.get();
    const userSettings = userDoc.exists ? userDoc.data().settings : {};
    if (!userSettings.isGoogleMailIntegrated) return;

    const lastCheckTimestamp = userSettings.lastEmailCheck;
    const query = lastCheckTimestamp
      ? `is:unread -in:spam -in:trash after:${lastCheckTimestamp.seconds}`
      : `is:unread -in:spam -in:trash newer_than:${fallbackIntervalMinutes}m`;

    const listResponse = await gmail.users.messages.list({ userId: 'me', q: query, maxResults: 10 });
    const newTimestamp = new Date();

    const messages = listResponse.data.messages;
    if (!messages || messages.length === 0) {
      await userDocRef.set({ settings: { lastEmailCheck: newTimestamp } }, { merge: true });
      return;
    }

    console.log(`gmailService: Found ${messages.length} new messages for user ${userId}.`);
    for (const messageHeader of messages) {
      const msgResponse = await gmail.users.messages.get({ userId: 'me', id: messageHeader.id, format: 'full' });
      const emailData = msgResponse.data;
      const headers = emailData.payload.headers;
      const subject = headers.find(h => h.name.toLowerCase() === 'subject')?.value || 'No Subject';
      const from = headers.find(h => h.name.toLowerCase() === 'from')?.value || 'Unknown';
      let bodySnippet = emailData.snippet;
      if (emailData.payload.parts) {
        const textPart = emailData.payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) bodySnippet = decode(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/')).trim();
      }
      const emailContent = {
        subject, from, bodySnippet,
        messageIdHeader: headers.find(h => h.name.toLowerCase() === 'message-id')?.value,
        threadId: emailData.threadId
      };

      const classification = await classifyEmail(emailContent);
      console.log(`Email from "${from}" classified as: ${classification}`);

      if (classification === EmailCategories.IMPORTANT) {
        let notificationBody = subject;
        // --- UPDATED LOGIC ---
        // If the subject is missing, create a summary from the body.
        if (subject === 'No Subject') {
          console.log('Important email has no subject. Generating summary for notification...');
          notificationBody = await generateSummaryForNotification(bodySnippet);
        }
        
        // Only send a notification if we have a valid body for it.
        if (notificationBody) {
          await sendImportantEmailNotification(userId, notificationBody);
        }

        // Only reply if the user has enabled this preference
        const emailPreference = userSettings.emailMonitoringPreference;
        if (emailPreference === 'ASSIST_REPLY') {
          const replyText = await generateReplyForImportantEmail(emailContent);
          if (replyText) {
            await sendReply(gmail, emailContent, replyText);
          }
        }
      }
      // Non-important emails are simply marked as read below, no other action needed.

      await gmail.users.messages.modify({ userId: 'me', id: messageHeader.id, requestBody: { removeLabelIds: ['UNREAD'] } });
    }

    await userDocRef.set({ settings: { lastEmailCheck: newTimestamp } }, { merge: true });
    console.log(`gmailService: Finished processing and updated timestamp for user ${userId}.`);
  } catch (error) {
    console.error(`gmailService: An error occurred for user ${userId}. Timestamp will not be updated.`, error);
    throw error;
  }
}
