// src/routes/twilioStreamRoutes.js
import twilio from 'twilio';
import { checkStreamingRequirements, createFallbackTwiML } from '../utils/streamingFallback.js';

// This is where you would import your context/appointment-fetching logic
// to get the appointmentId
// For now, we'll assume it's passed in the Twilio request or is a test
// import { getAppointmentRef } from '../config/firebaseAdmin.js'; 

export function setupTwilioStreamRoutes(app) {
    
    /**
     * This is the new entry point for your Twilio call.
     * It responds with TwiML to connect to our WebSocket server.
     */
    app.post('/api/twilio/initiate-stream', async (req, res) => {
        console.log('[INFO] POST /api/twilio/initiate-stream hit.');
        
        // 🛠️ Get appointmentId from query parameters
        const { appointmentId } = req.query;

        if (!appointmentId) {
            console.error('[ERROR] No appointmentId in query. Cannot start stream.');
            return res.status(400).send('No appointmentId provided.');
        }

        console.log(`[INFO] Starting stream for appointment: ${appointmentId}`);

        // Check if streaming requirements are met
        const { canStream, requirements } = checkStreamingRequirements();
        
        if (!canStream) {
            console.warn('[WARN] Streaming requirements not met, falling back to TwiML');
            console.warn('[WARN] Missing requirements:', 
                Object.entries(requirements)
                    .filter(([key, value]) => !value)
                    .map(([key]) => key)
            );
            
            const fallbackTwiml = createFallbackTwiML(appointmentId, 'Streaming not available');
            res.type('text/xml');
            res.send(fallbackTwiml.toString());
            return;
        }

        try {
            const twiml = new twilio.twiml.VoiceResponse();
            
            // This tells Twilio to stop using TwiML and open a 
            // bi-directional WebSocket connection to your server.
            const connect = twiml.connect();
            
            // Use secure WebSocket for production
            const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
            const webSocketUrl = `${protocol}://${req.headers.host}/audio-stream/${appointmentId}`;
            console.log(`[INFO] Telling Twilio to connect to: ${webSocketUrl}`);
            
            connect.stream({
                url: webSocketUrl, 
            });

            // Add a pause to keep the call alive while the WebSocket connects
            // This prevents the call from dropping immediately.
            twiml.pause({ length: 20 }); 

            res.type('text/xml');
            res.send(twiml.toString());
            
        } catch (error) {
            console.error('[ERROR] Failed to create streaming TwiML:', error);
            
            // Fallback to regular TwiML system
            const fallbackTwiml = createFallbackTwiML(appointmentId, 'TwiML creation failed');
            res.type('text/xml');
            res.send(fallbackTwiml.toString());
        }
    });
}