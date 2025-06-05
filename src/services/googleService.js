// src/services/gmailService.js
import { google } from 'googleapis';
import { db } from '../config/firebaseAdmin.js';
import { generateGeminiText } from '../utils/geminiClient.js';
import { getUserGoogleTokens } from './googleTokenService.js'; // To get stored tokens
import { decode } from 'js-base64'; // Gmail API returns email body base64url encoded


// --- Helper to get an authenticated OAuth2 client ---
async function getAuthenticatedOAuth2Client(userId) {
  const tokenData = await getUserGoogleTokens(userId);
  if (!tokenData || !tokenData.accessToken) {
    console.error(`gmailService: No valid Google tokens found for user ${userId}.`);
    return null;
  }

  // TODO: Implement token refresh logic if accessToken is expired
  // This involves using the refreshToken to get a new accessToken.
  // The googleapis library can handle this automatically if configured correctly
  // or you can do it manually. For now, we'll assume the token is fresh or
  // refresh logic is handled by the caller or a scheduled job.

  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID, // Your Google Client ID from .env
    process.env.GOOGLE_CLIENT_SECRET, // Your Google Client Secret from .env
    // The redirect URI here is usually for the server-side flow if you initiate it from backend,
    // but for using existing tokens, it's less critical.
    // However, it's good practice for the client to be fully configured.
    // This might be your backend's redirect URI if you have one for a server-to-server flow.
  );
  oauth2Client.setCredentials({
    access_token: tokenData.accessToken,
    refresh_token: tokenData.refreshToken, // Important for refreshing
    // expiry_date: (tokenData.grantedAt.toDate().getTime() + (tokenData.expiresIn * 1000)), // If you have expiry
  });

  // Handle token refresh
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.refresh_token) {
      // store the new tokens (especially refresh_token if it changes)
      console.log('gmailService: New refresh token received, storing...');
      // await storeUserGoogleTokens(userId, { ...tokenData, refreshToken: tokens.refresh_token, accessToken: tokens.access_token });
    }
    console.log('gmailService: Access token refreshed.');
  });


  return oauth2Client;
}

// --- Email Classification ---
const EmailCategories = {
  SPAM_BY_AI: 'SPAM_BY_AI', // Custom AI spam detection
  IMPORTANT_URGENT: 'IMPORTANT_URGENT',
  PERSONAL_OPPORTUNITY: 'PERSONAL_OPPORTUNITY',
  GENERAL_PERSONAL: 'GENERAL_PERSONAL',
  TRANSACTIONAL_INFO: 'TRANSACTIONAL_INFO', // e.g., receipts, shipping
  NEWSLETTER_PROMO: 'NEWSLETTER_PROMO',
  UNKNOWN_NEEDS_REVIEW: 'UNKNOWN_NEEDS_REVIEW',
};

async function classifyEmailWithGemini(emailContent) {
  const { subject, from, bodySnippet } = emailContent;
  const prompt = `Analyze the following email content and classify it into one of these categories:
${Object.values(EmailCategories).join(', ')}.

Consider the sender, subject, and the email body snippet.
- ${EmailCategories.IMPORTANT_URGENT}: Critical, time-sensitive, requires immediate attention (e.g., job offer final steps, legal notice, overdue bill).
- ${EmailCategories.PERSONAL_OPPORTUNITY}: Networking, potential collaborations, invitations, non-urgent job leads.
- ${EmailCategories.GENERAL_PERSONAL}: Casual conversation from friends, family, or known contacts.
- ${EmailCategories.TRANSACTIONAL_INFO}: Receipts, shipping updates, account notifications, appointment confirmations.
- ${EmailCategories.NEWSLETTER_PROMO}: Marketing emails, newsletters, promotional offers.
- ${EmailCategories.SPAM_BY_AI}: Unsolicited commercial email, phishing attempts, scams (even if Gmail didn't catch it).
- ${EmailCategories.UNKNOWN_NEEDS_REVIEW}: If unsure or doesn't fit well into other categories.

Email From: ${from}
Email Subject: ${subject}
Email Body Snippet (first 200 characters): ${bodySnippet.substring(0, 200)}

Return ONLY the category label (e.g., "${EmailCategories.IMPORTANT_URGENT}").`;

  try {
    const classificationRaw = await generateGeminiText(prompt);
    const classification = classificationRaw ? classificationRaw.trim().toUpperCase() : EmailCategories.UNKNOWN_NEEDS_REVIEW;
    if (Object.values(EmailCategories).map(c => c.toUpperCase()).includes(classification)) {
      return classification;
    }
    return EmailCategories.UNKNOWN_NEEDS_REVIEW;
  } catch (error) {
    console.error('gmailService: Error classifying email with Gemini:', error);
    return EmailCategories.UNKNOWN_NEEDS_REVIEW;
  }
}

// --- Reply Generation ---
async function generateReplyWithGemini(emailContent, classification) {
  const { subject, from, bodySnippet, toAddresses } = emailContent; // toAddresses is needed for "To" field in reply

  // Determine salutation
  let senderName = from.includes('<') ? from.substring(0, from.indexOf('<')).trim() : from.split('@')[0];
  senderName = senderName.replace(/[^a-zA-Z0-9 ]/g, ''); // Sanitize

  const prompt = `You are Aiva, an AI assistant helping a user manage their emails.
The user received an email classified as "${classification}".
Email From: ${from} (Sender's Name: ${senderName})
Email Subject: ${subject}
Email Body Snippet: ${bodySnippet}

Draft a polite and professional reply.
- If the classification is ${EmailCategories.PERSONAL_OPPORTUNITY} or ${EmailCategories.GENERAL_PERSONAL}:
  - Be warm and engaging if appropriate.
  - If the email asks a question or requires action, and you have enough context from the snippet to provide a basic, helpful response or ask a clarifying question, do so.
  - **Crucially, if you DO NOT have enough information from this snippet to provide a specific answer or take meaningful action, draft a polite acknowledgment message. Examples: "Thanks for reaching out, ${senderName}. I'll look into this and get back to you shortly." or "Hi ${senderName}, thanks for your message. Let me review this and I'll respond soon."**
  - Do NOT invent information or make commitments you can't fulfill based on the snippet.
  - If the email is extremely vague (e.g., just "hi", or content not actionable even for a holding message), output ONLY the phrase: "NO_REPLY_INSUFFICIENT_CONTEXT".
- Your reply should be concise.
- Sign off as "Best regards, [User's Name]" (You don't know the user's name, so use a generic but professional sign-off if needed, or let's assume Aiva signs for the user, e.g., "Best, Aiva for [User's Name]"). For now, just use "Best regards,".

Your drafted reply:
`;

  try {
    const replyRaw = await generateGeminiText(prompt);
    if (replyRaw && replyRaw.trim().toUpperCase() === "NO_REPLY_INSUFFICIENT_CONTEXT") {
      console.log(`gmailService: Gemini determined insufficient context for email subject "${subject}" from ${from}.`);
      return null;
    }
    return replyRaw ? replyRaw.trim() : null;
  } catch (error) {
    console.error('gmailService: Error generating reply with Gemini:', error);
    return null; // Don't send a reply if generation fails
  }
}

// --- Main Email Processing Logic ---
export async function checkAndProcessUserEmails(userId) {
  console.log(`gmailService: Starting email check for user ${userId}.`);
  const oauth2Client = await getAuthenticatedOAuth2Client(userId);
  if (!oauth2Client) return;

  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  // Get user's email monitoring preference
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.exists ? userDoc.data() : {};
  const userSettings = userData.settings || {};
  const emailPreference = userSettings.emailMonitoringPreference || 'NOTIFY_ONLY'; // Default to notify
  const isMailIntegrated = userSettings.isGoogleMailIntegrated === true;

  if (!isMailIntegrated) {
      console.log(`gmailService: Email monitoring not fully enabled or integrated for user ${userId}.`);
      return;
  }
  console.log(`gmailService: User ${userId} preference: ${emailPreference}`);

  try {
    // Fetch unread emails, not in SPAM or TRASH, and not from self (to avoid loops with auto-replies)
    // You might want to store the user's actual email address to use in the 'from' query.
    // For now, this is a generic query.
    const listResponse = await gmail.users.messages.list({
      userId: 'me',
      q: 'is:unread -in:spam -in:trash -category:social -category:promotions', // Basic query, refine as needed
      maxResults: 5, // Process a few at a time to avoid hitting limits quickly
    });

    const messages = listResponse.data.messages;
    if (!messages || messages.length === 0) {
      console.log(`gmailService: No new unread messages found for user ${userId}.`);
      return;
    }

    console.log(`gmailService: Found ${messages.length} new messages for user ${userId}. Processing...`);

    for (const messageHeader of messages) {
      const msgResponse = await gmail.users.messages.get({
        userId: 'me',
        id: messageHeader.id,
        format: 'full', // Get full details including headers and body
      });

      const email = msgResponse.data;
      const headers = email.payload.headers;
      const subject = headers.find(header => header.name.toLowerCase() === 'subject')?.value || 'No Subject';
      const from = headers.find(header => header.name.toLowerCase() === 'from')?.value || 'Unknown Sender';
      const toHeader = headers.find(header => header.name.toLowerCase() === 'to');
      const toAddresses = toHeader ? toHeader.value : 'unknown@example.com'; // Fallback
      const messageIdHeader = headers.find(header => header.name.toLowerCase() === 'message-id')?.value;


      let bodySnippet = email.snippet; // Gmail's snippet is usually plain text
      // For a more complete body, you'd parse email.payload.parts if it's multipart
      // This can get complex. For now, snippet is a good start.
      // Example of getting plain text body if available:
      if (email.payload.parts) {
          const textPart = email.payload.parts.find(part => part.mimeType === 'text/plain');
          if (textPart && textPart.body && textPart.body.data) {
              bodySnippet = decode(textPart.body.data.replace(/-/g, '+').replace(/_/g, '/')).trim();
          }
      } else if (email.payload.body && email.payload.body.data) {
          // For non-multipart emails
           bodySnippet = decode(email.payload.body.data.replace(/-/g, '+').replace(/_/g, '/')).trim();
      }


      const emailContent = { subject, from, toAddresses, bodySnippet, threadId: email.threadId, messageIdHeader };
      console.log(`gmailService: Processing email from ${from} - Subject: ${subject}`);

      const classification = await classifyEmailWithGemini(emailContent);
      console.log(`gmailService: Email classified as: ${classification}`);
      // TODO: Store this classification in Firestore log if needed

      if (classification === EmailCategories.SPAM_BY_AI) {
        // Optional: Mark as spam in Gmail or move to a "AI Processed Spam" folder
        console.log(`gmailService: Email from ${from} marked as SPAM_BY_AI. No reply.`);
      } else if (
        (classification === EmailCategories.PERSONAL_OPPORTUNITY || classification === EmailCategories.GENERAL_PERSONAL) &&
        emailPreference === 'ASSIST_REPLY' // Check user's preference from aivaServices flow
      ) {
        const replyText = await generateReplyWithGemini(emailContent, classification);
        if (replyText) {
          console.log(`gmailService: Generated reply for email from ${from}: "${replyText.substring(0,50)}..."`);
          // ---- SENDING EMAIL ----
          // Ensure proper "In-Reply-To" and "References" headers for threading.
          // The subject should be "Re: [original subject]"
          const originalSubject = emailContent.subject.startsWith("Re: ") ? emailContent.subject : `Re: ${emailContent.subject}`;
          const rawMessage = [
            `To: ${emailContent.from}`, // Replying to the original sender
            `Subject: ${originalSubject}`,
            `In-Reply-To: ${emailContent.messageIdHeader}`,
            `References: ${emailContent.messageIdHeader}`, // Simple reference, Gmail API might handle more complex threading
            'Content-Type: text/plain; charset="UTF-8"',
            'MIME-Version: 1.0',
            '',
            replyText,
          ].join('\n');

          const encodedMessage = Buffer.from(rawMessage).toString('base64url');

          await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
              raw: encodedMessage,
              threadId: emailContent.threadId, // Important for threading
            },
          });
          console.log(`gmailService: Reply sent successfully to ${emailContent.from} for subject: ${emailContent.subject}`);
          // TODO: Log reply action in Firestore
        }
      } else if (classification === EmailCategories.IMPORTANT_URGENT) {
        // TODO: Implement notification logic (e.g., send a message via Aiva, push notification)
        console.log(`gmailService: Email from ${from} is IMPORTANT_URGENT. User should be notified.`);
      }

      // Mark email as read or apply a label to avoid reprocessing
      await gmail.users.messages.modify({
        userId: 'me',
        id: messageHeader.id,
        requestBody: {
          removeLabelIds: ['UNREAD'],
          // addLabelIds: ['AI_PROCESSED'] // Optional: add a custom label
        },
      });
      console.log(`gmailService: Email ${messageHeader.id} marked as read.`);
      await new Promise(resolve => setTimeout(resolve, 1000)); // Small delay to avoid hitting API limits too fast
    }
  } catch (error) {
    console.error('gmailService: Error processing emails:', error.message);
    if (error.response && error.response.data) {
        console.error('gmailService: Gmail API Error Details:', error.response.data.error);
    }
    // If auth error (e.g., token revoked), mark isGoogleMailIntegrated as false
    if (error.code === 401 || (error.response && error.response.status === 401)) {
        await db.collection('users').doc(userId).set({ settings: { isGoogleMailIntegrated: false } }, { merge: true });
        console.warn(`gmailService: Disabled Google Mail integration for user ${userId} due to auth error.`);
    }
  }
}