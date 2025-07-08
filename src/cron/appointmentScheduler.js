// src/schedulers/appointmentScheduler.js
import cron from 'node-cron';
import { db } from '../config/firebaseAdmin.js';
import twilio from 'twilio';

console.log('Appointment scheduler initialized. Waiting for jobs...');

// This cron job runs every two minutes
// cron.schedule('*/1 * * * *', async () => {
//     console.log('--- Cron Job Started: Running appointment check cron job ---');
//     const now = new Date();
//     console.log(`Current time: ${now.toISOString()}`);

//     // Query for pending appointments where the preferred call time is now or in the past
//     console.log('Querying for pending appointments...');
//     const appointmentsRef = db.collectionGroup('appointments')
//         .where('status', '==', 'pending')
//         .where('reminder_iso_string_with_offset', '<=', now); // Changed to <= to include past times
        
//     const snapshot = await appointmentsRef.get();
    
//     console.log(`Firestore Snapshot received. Number of documents: ${snapshot.size}`);

//     if (snapshot.empty) {
//         console.log('No pending appointments to process at this time.');
//         console.log('--- Cron Job Finished: No appointments found ---');
//         return;
//     }

//     console.log(`Found ${snapshot.size} pending appointment(s) to process.`);
//     const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

//     for (const doc of snapshot.docs) {
//         const appointment = doc.data();
//         const appointmentId = doc.id;

//         console.log(`--- Processing Appointment ${appointmentId} ---`);
//         console.log(`Appointment Details: User ID - ${appointment.userId}, Contact - ${appointment.bookingContactNumber}, Preferred Call Time - ${appointment.preferredCallTime ? appointment.preferredCallTime.toDate().toISOString() : 'N/A'}`);

//         try {
//             console.log(`Attempting to update status to 'calling' for appointment ${appointmentId}...`);
//             await doc.ref.update({ status: 'calling' });
//             console.log(`Status updated to 'calling' for appointment ${appointmentId}.`);
            
//             // --- UPDATED: Using dynamic URL and status callbacks ---
//             const webhookUrl = `${process.env.API_BASE_URL}/api/twilio/twiML/appointmentCall?appointmentId=${appointmentId}`;
//             const statusCallbackUrl = `${process.env.API_BASE_URL}/api/twilio/twiML/callStatus?appointmentId=${appointmentId}`;

//             console.log(`Initiating Twilio call for ${appointment.bookingContactNumber}...`);
//             console.log(`TwiML Webhook URL: ${webhookUrl}`);
//             console.log(`Status Callback URL: ${statusCallbackUrl}`);

//             await client.calls.create({
//                 url: webhookUrl, // Use a URL to generate dynamic TwiML
//                 to: appointment.bookingContactNumber,
//                 from: process.env.TWILIO_PHONE_NUMBER,
//                 statusCallback: statusCallbackUrl,
//                 statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'], // Events to track
//                 machineDetection: 'Enable', // Enable Answering Machine Detection
//                 asyncAmd: true, // Use asynchronous AMD for better accuracy
//                 asyncAmdStatusCallback: statusCallbackUrl, // Send AMD result to the same handler
//             });

//             console.log(`Successfully initiated call for appointment ${appointmentId}. Call details sent to Twilio.`);

//         } catch (error) {
//             console.error(`ERROR: Failed to process appointment ${appointmentId}:`, error.message);
//             if (error.code) {
//                 console.error(`Twilio Error Code (if applicable): ${error.code}`);
//             }
//             await doc.ref.update({ status: 'failed', error: error.message });
//             console.log(`Appointment ${appointmentId} status updated to 'failed' due to error.`);
//         }
//         console.log(`--- Finished processing Appointment ${appointmentId} ---`);
//     }
//     console.log('--- Cron Job Finished: All appointments processed ---');
// });

export const test = async () => {
    console.log('--- Cron Job Started: Running appointment check cron job ---');
    const now = new Date();
    console.log(`Current time: ${now.toISOString()}`);

    // Query for pending appointments where the preferred call time is now or in the past
    console.log('Querying for pending appointments...');
    const appointmentsRef = db.collectionGroup('appoitments')
        // .where('status', '==', 'pending')
        // .where('scheduleTime', '<=', now); // Changed to <= to include past times
        
    const snapshot = await appointmentsRef.get();
    
    console.log(`Firestore Snapshot received. Number of documents: ${snapshot.size}`);

    if (snapshot.empty) {
        console.log('No pending appointments to process at this time.');
        console.log('--- Cron Job Finished: No appointments found ---');
        return;
    }

    console.log(`Found ${snapshot.size} pending appointment(s) to process.`);
    const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);

    for (const doc of snapshot.docs) {

        const appointment = doc.data();
        console.log(appointment)
        const appointmentId = doc.id;

        console.log(`--- Processing Appointment ${appointmentId} ---`);
        console.log(`Appointment Details: User ID - ${appointment.userId}, Contact - ${appointment.bookingContactNumber}, Preferred Call Time - ${appointment.reminder_iso_string_with_offset ? appointment.reminder_iso_string_with_offset : 'N/A'}`);

        try {
            console.log(`Attempting to update status to 'calling' for appointment ${appointmentId}...`);
            await doc.ref.update({ status: 'calling' });
            console.log(`Status updated to 'calling' for appointment ${appointmentId}.`);
            
            // --- UPDATED: Using dynamic URL and status callbacks ---
            const webhookUrl = `${process.env.API_BASE_URL}/api/twilio/twiML/appointmentCall?appointmentId=${appointmentId}`;
            const statusCallbackUrl = `${process.env.API_BASE_URL}/api/twilio/twiML/callStatus?appointmentId=${appointmentId}`;

            console.log(`Initiating Twilio call for ${appointment.bookingContactNumber}...`);
            console.log(`TwiML Webhook URL: ${webhookUrl}`);
            console.log(`Status Callback URL: ${statusCallbackUrl}`);

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

            console.log(`Successfully initiated call for appointment ${appointmentId}. Call details sent to Twilio.`);

        } catch (error) {
            console.error(`ERROR: Failed to process appointment ${appointmentId}:`, error.message);
            if (error.code) {
                console.error(`Twilio Error Code (if applicable): ${error.code}`);
            }
            await doc.ref.update({ status: 'pending', error: error.message });
            console.log(`Appointment ${appointmentId} status updated to 'failed' due to error.`);
        }
        console.log(`--- Finished processing Appointment ${appointmentId} ---`);
    }
    console.log('--- Cron Job Finished: All appointments processed ---');
}