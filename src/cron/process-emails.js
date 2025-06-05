// src/pages/api/cron/process-emails.js (Example for Next.js on Vercel)
// If using pure Express, this would be a route handler in your Express app.
import { db } from '../config/firebaseAdmin.js'; // Adjust path as needed
import { checkAndProcessUserEmails } from '../services/googleService.js'; // Adjust path as needed

export default async function handler(req, res) {
  // Optional: Secure your cron endpoint (e.g., with a secret header/query param)
  // if (req.headers['x-cron-secret'] !== process.env.CRON_JOB_SECRET) {
  //   return res.status(401).json({ error: 'Unauthorized' });
  // }

  if (req.method === 'POST' || req.method === 'GET') { // Vercel Cron usually sends POST or GET
    try {
      console.log('Cron job: Starting to process user emails...');
      const usersSnapshot = await db.collection('users')
        .where('settings.isGoogleMailIntegrated', '==', true)
        // Optionally, filter by emailMonitoringPreference if you only want to process for 'ASSIST_REPLY'
        // .where('settings.emailMonitoringPreference', '==', 'ASSIST_REPLY')
        .get();

      if (usersSnapshot.empty) {
        console.log('Cron job: No users found for email processing.');
        return res.status(200).json({ message: 'No users to process.' });
      }

      const processingPromises = [];
      usersSnapshot.forEach(doc => {
        const userId = doc.id;
        console.log(`Cron job: Queueing email processing for user ${userId}`);
        // We call checkAndProcessUserEmails but don't await each one individually
        // inside the loop to avoid holding the main cron function for too long.
        // However, for simplicity here, we'll await.
        // For many users, consider a fan-out pattern or background tasks.
        processingPromises.push(checkAndProcessUserEmails(userId));
      });

      // Wait for all processing to attempt completion
      // Be mindful of serverless function execution time limits
      await Promise.allSettled(processingPromises);

      console.log(`Cron job: Finished processing batch of ${usersSnapshot.size} users.`);
      return res.status(200).json({ message: `Processed emails for ${usersSnapshot.size} users.` });

    } catch (error) {
      console.error('Cron job error processing emails:', error);
      return res.status(500).json({ error: 'Failed to process emails.' });
    }
  } else {
    res.setHeader('Allow', ['POST', 'GET']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}