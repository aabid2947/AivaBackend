// src/schedulers/appointmentScheduler.js
import cron from 'node-cron';
import { db } from '../config/firebaseAdmin.js';
import twilio from 'twilio';

console.log('Appointment scheduler initialized. Waiting for jobs...');

// This cron job runs every two minutes
cron.schedule('*/2 * * * *', async () => {
    console.log('Running appointment check cron job...');
    const now = new Date();

    // Query for pending appointments where the preferred call time is now or in the past
    const appointmentsRef = db.collectionGroup('appointments')
        .where('status', '==', 'pending')
        .where('preferredCallTime', '<=', now); // Querying the timestamp directly

    const snapshot = await appointmentsRef.get();

    if (snapshot.empty) {
        console.log('No pending appointments to process at this time.');
        return;
    }

    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    for (const doc of snapshot.docs) {
        const appointment = doc.data();
        const appointmentId = doc.id;

        console.log(`Processing appointment ${appointmentId} for user ${appointment.userId}...`);

        try {
            await doc.ref.update({ status: 'calling' });
            
            // --- UPDATED: Using dynamic URL and status callbacks ---
            const webhookUrl = `${process.env.API_BASE_URL}/api/twilio/twiML/appointmentCall?appointmentId=${appointmentId}`;
            const statusCallbackUrl = `${process.env.API_BASE_URL}/api/twilio/twiML/callStatus?appointmentId=${appointmentId}`;

            await client.calls.create({
                url: webhookUrl, // Use a URL to generate dynamic TwiML
                to: appointment.bookingContactNumber,
                from: process.env.TWILIO_PHONE_NUMBER,
                statusCallback: statusCallbackUrl,
                statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'], // Events to track
                machineDetection: 'Enable', // Enable Answering Machine Detection
                asyncAmd: true, // Use asynchronous AMD for better accuracy
                asyncAmdStatusCallback: statusCallbackUrl, // Send AMD result to the same handler
            });

            console.log(`Successfully initiated call for appointment ${appointmentId}.`);

        } catch (error) {
            console.error(`Failed to process appointment ${appointmentId}:`, error);
            await doc.ref.update({ status: 'failed', error: error.message });
        }
    }
});
