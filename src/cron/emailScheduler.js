// src/services/scheduler.js
// This file runs a cron job to continue monitoring emails
import cron from 'node-cron';
import { checkAndProcessUserEmails, getUsersWithEmailMonitoringEnabled } from '../services/gmailService.js';

console.log('Scheduler initialized. Cron job is set to run.');

const CRON_INTERVAL_MINUTES = 2;

// Changed to every 2 minutes to provide a safer buffer for API limits.
cron.schedule(`*/${CRON_INTERVAL_MINUTES} * * * *`, async () => {
  console.log('----------------------------------------------------');
  console.log(`[${new Date().toISOString()}] Running scheduled email check...`);

  try {
    const userIds = await getUsersWithEmailMonitoringEnabled();

    if (userIds.length > 0) {
      console.log(`Scheduler: Found ${userIds.length} user(s) to process. Starting checks...`);
      // Using Promise.allSettled to run checks in parallel and not stop if one fails
      const results = await Promise.allSettled(
        // Pass the interval to the function
        userIds.map(userId => checkAndProcessUserEmails(userId, CRON_INTERVAL_MINUTES))
      );
      
      // Log the results of each user's check
      results.forEach((result, index) => {
        const userId = userIds[index];
        if (result.status === 'rejected') {
          console.error(`Scheduler: Task for user ${userId} failed. Reason:`, result.reason?.message || result.reason);
        } else {
          console.log(`Scheduler: Task for user ${userId} completed successfully.`);
        }
      });
      
      console.log('Scheduler: Finished processing all users for this cycle.');
    } else {
      console.log('Scheduler: No active users to process in this cycle.');
    }
  } catch (error) {
    // This will catch errors in getUsersWithEmailMonitoringEnabled or if Promise.allSettled itself has an issue
    console.error('Scheduler: A critical error occurred during the scheduled task setup:', error);
  }
  console.log('----------------------------------------------------');
});
