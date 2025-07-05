// src/cron/appointmentScheduler.js
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
        .where('preferredCallTime', '<=', now.toISOString());

    const snapshot = await appointmentsRef.get();

    if (snapshot.empty) {
        console.log('No pending appointments to process at this time.');
        return;
    }

    // Initialize Twilio client
    // Ensure TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are in your .env file
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    snapshot.forEach(async (doc) => {
        const appointment = doc.data();
        const appointmentId = doc.id;
        const userId = appointment.userId;

        console.log(`Processing appointment ${appointmentId} for user ${userId}...`);

        try {
            // Update status to 'calling' to prevent reprocessing
            await doc.ref.update({ status: 'calling' });
            
            // TwiML URL that will guide the call. You'll need to create this endpoint.
            // It should provide instructions and record the response.
            const twimlUrl = `${process.env.API_BASE_URL}/api/twilio/twiML/appointmentCall?appointmentId=${appointmentId}&userId=${userId}`;

            // Make the call using Twilio
            await client.calls.create({
                twiml: `<Response><Say>Hello, this is Aiva calling on behalf of ${appointment.patientName} to book an appointment for ${appointment.reasonForAppointment}.</Say><Record maxLength="60" action="${process.env.API_BASE_URL}/api/twilio/twiML/handleRecording?appointmentId=${appointmentId}&userId=${userId}" /><Say>We did not receive a recording. Goodbye.</Say></Response>`,
                to: appointment.bookingContactNumber,
                from: process.env.TWILIO_PHONE_NUMBER,
            });

            console.log(`Successfully initiated call for appointment ${appointmentId}.`);

        } catch (error) {
            console.error(`Failed to process appointment ${appointmentId}:`, error);
            // Revert status to 'pending' or set to 'failed'
            await doc.ref.update({ status: 'failed', error: error.message });
        }
    });
});
