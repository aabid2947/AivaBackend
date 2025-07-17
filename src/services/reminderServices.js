// src/services/reminderService.js
// This service checks for due reminders and sends push notifications via FCM.

import { db, admin } from '../config/firebaseAdmin.js';
import { generateGeminiText } from '../utils/geminiClient.js';
/**
 * Fetches all reminders that are due and have not been sent yet.
 * A reminder is considered "due" if its reminderDateTime is in the past.
 * @returns {Promise<Array<object>>} A list of reminder objects with their IDs.
 */
async function getDueReminders() {
  const now = new Date();
  const remindersRef = db.collectionGroup('paymentReminders');
  
  // Query for reminders that are due and still marked as 'pending'.
  const snapshot = await remindersRef
    .where('status', '==', 'pending')
    .where('reminderDateTime', '<=', now)
    .get();

  if (snapshot.empty) {
    return [];
  }

  const dueReminders = [];
  snapshot.forEach(doc => {
    dueReminders.push({
      id: doc.id,
      ...doc.data()
    });
  });

  return dueReminders;
}

/**
 * Sends a push notification to a user's device using their FCM token.
 * @param {string} fcmToken - The Firebase Cloud Messaging token for the user's device.
 * @param {object} reminder - The reminder object containing the details.
 */
async function sendPushNotification(fcmToken, reminder) {
 const prompt = `
You are a smart assistant. Rewrite the following reminder as a short, direct notification message to the user. 

The output must:
- Be a single sentence
- Be no more than 5-6 words
- Do NOT include any explanation or introduction text.

Reminder: ${reminder.taskDescription}

Respond with ONLY the notification sentence.`;
const summarizedResponse = await generateGeminiText(prompt);
console.log(summarizedResponse)
  const message = {
    notification: {
      title: 'Reminder',
      body:summarizedResponse,
    },
    token: fcmToken,
    // You can also add custom data to handle the notification in your app
    data: {
      reminderId: reminder.id,
      chatId: reminder.chatId || '', // If you want to navigate to a specific chat
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log('Successfully sent message:', response);
    return true;
  } catch (error) {
    console.error('Error sending message:', error);
    // If the token is invalid, you might want to remove it from the DB
    if (error.code === 'messaging/registration-token-not-registered') {
      // Logic to remove the invalid token for the user
    }
    return false;
  }
}

/**
 * The main function to be called by the cron job.
 * It fetches due reminders, gets the user's FCM token, sends a notification,
 * and updates the reminder status.
 */
export async function checkAndSendReminders() {
  console.log('Checking for due reminders...');
  const reminders = await getDueReminders();

  if (reminders.length === 0) {
    console.log('No due reminders found.');
    return;
  }

  console.log(`Found ${reminders.length} due reminders to process.`);

  for (const reminder of reminders) {
    try {
      const userRef = db.collection('users').doc(reminder.userId);
      const userDoc = await userRef.get();

      if (!userDoc.exists || !userDoc.data().fcmToken) {
        console.warn(`User ${reminder.userId} does not have an FCM token. Skipping reminder.`);
        continue;
      }

      const fcmToken = userDoc.data().fcmToken;
      const notificationSent = await sendPushNotification(fcmToken, reminder);

      if (notificationSent) {
        // Update the reminder status to 'sent' to avoid re-sending
        const reminderRef = userRef.collection('paymentReminders').doc(reminder.id);
        await reminderRef.update({ status: 'sent' });
        console.log(`Reminder ${reminder.id} for user ${reminder.userId} marked as sent.`);
      }
    } catch (error) {
      console.error(`Failed to process reminder ${reminder.id} for user ${reminder.userId}:`, error);
    }
  }
}
