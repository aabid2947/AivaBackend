// src/schedulers/reminderScheduler.js
// This file runs a cron job to check for and send payment reminders.

import cron from 'node-cron';
import { checkAndSendReminders } from '../services/reminderServices.js';

console.log('Reminder Scheduler initialized.');

// Schedule the cron job to run every minute.
cron.schedule('* * * * *', async () => {
  console.log('----------------------------------------------------');
  console.log(process.env.GEMINI_API_KEY)
  console.log(`[${new Date().toISOString()}] Running scheduled reminder check...`);
  
  try {
    await checkAndSendReminders();
  } catch (error) {
    console.error('A critical error occurred during the reminder check:', error);
  }
  
  console.log('Reminder check cycle finished.');
  console.log('----------------------------------------------------');
});
