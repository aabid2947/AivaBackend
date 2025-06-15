// ==============================================================================
//  Node.js Server for AI-Powered Appointment Calls (ES Module Version)
// ==============================================================================
//
//  This server uses Express, Twilio, and Google Gemini to make intelligent,
//  multi-language appointment confirmation calls.
//
//  --- SETUP INSTRUCTIONS ---
//  1. In your `package.json` file, add the following line to enable ES Modules:
//     "type": "module"
//
//  2. Install dependencies:
//     npm install express twilio @google/generative-ai dotenv
//
//  3. Create a `.env` file in the same directory with these contents:
//     TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
//     TWILIO_AUTH_TOKEN=your_auth_token
//     TWILIO_PHONE_NUMBER=+15017122661
//     GEMINI_API_KEY=your_gemini_api_key
//     SERVER_BASE_URL=http://your-public-ngrok-or-server-url.com
//
//  4. Replace placeholder values with your credentials.
//     - SERVER_BASE_URL must be a publicly accessible URL (e.g., from ngrok).
//
//  5. Run the server:
//     node your_file_name.js
//
// ==============================================================================

import express from 'express';
import twilio from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// --- Configuration and Initialization ---
dotenv.config(); // Loads environment variables from a .env file

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware to parse incoming requests
app.use(express.urlencoded({ extended: true }));
app.use(express.json());


// --- Client Initialization ---

// Twilio Client
if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) {
    console.error("FATAL ERROR: Twilio credentials are not set in the .env file.");
    process.exit(1);
}
const twilioClient = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
);

// Gemini AI Client
if (!process.env.GEMINI_API_KEY) {
    console.error("FATAL ERROR: Gemini API Key is not set in the .env file.");
    process.exit(1);
}
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-pro" });


// ==============================================================================
//  Service Function for Initiating the Call
// ==============================================================================
/**
 * A service function that initiates the Twilio call.
 * @param {object} params - The appointment details.
 * @param {string} params.phoneNumber - The E.164 formatted phone number.
 * @param {string} params.name - The name of the person.
 * @param {string} params.appointmentDate - The proposed date.
 * @param {string} params.reason - The reason for the appointment.
 * @returns {Promise<twilio.CallInstance>} The created call instance from Twilio.
 */
async function initiateAppointmentCall({ phoneNumber, name, appointmentDate, reason }) {
    // Encode appointment details into the callback URL for Twilio
    const initialPromptUrl = new URL(`${process.env.SERVER_BASE_URL}/initial-prompt`);
    initialPromptUrl.searchParams.append('name', name);
    initialPromptUrl.searchParams.append('appointmentDate', appointmentDate);
    initialPromptUrl.searchParams.append('reason', reason);

    try {
        const call = await twilioClient.calls.create({
            url: initialPromptUrl.href,
            to: phoneNumber,
            from: process.env.TWILIO_PHONE_NUMBER,
        });
        console.log(`Call initiated successfully via service. SID: ${call.sid}`);
        return call;
    } catch (error) {
        console.error('Error in initiateAppointmentCall service:', error);
        // Re-throw the error to be handled by the calling route
        throw new Error('Failed to initiate Twilio call.');
    }
}


// ==============================================================================
//  API Routes / Endpoints
// ==============================================================================

/**
 * @api {post} /start-appointment-call Initiate the appointment call
 * This endpoint now uses the dedicated service function.
 */
app.post('/start-appointment-call', async (req, res) => {
    const { phoneNumber, name, appointmentDate, reason } = req.body;

    if (!phoneNumber || !name || !appointmentDate || !reason) {
        return res.status(400).json({ success: false, message: 'Missing required appointment details.' });
    }

    try {
        const call = await initiateAppointmentCall({ phoneNumber, name, appointmentDate, reason });
        res.status(200).json({
            success: true,
            message: 'Appointment call has been initiated.',
            callSid: call.sid,
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message,
        });
    }
});

/**
 * @api {post} /initial-prompt Generate the first TwiML prompt
 * This is the webhook Twilio calls when the phone is answered.
 */
app.post('/initial-prompt', (req, res) => {
    const { name, appointmentDate, reason } = req.query;
    const { VoiceResponse } = twilio.twiml;
    const response = new VoiceResponse();
    
    const gather = response.gather({
        input: 'speech',
        action: `/process-speech?name=${encodeURIComponent(name)}&appointmentDate=${encodeURIComponent(appointmentDate)}&reason=${encodeURIComponent(reason)}`,
        speechTimeout: 'auto',
        language: 'en-US',
    });
    
    gather.say(
        `Hello ${name}. This is an automated call to confirm your appointment regarding ${reason} for ${appointmentDate}. Please say 'yes' to confirm, or state your preferred date and time.`
    );
    
    response.say('We did not receive a response. Goodbye.');
    response.hangup();

    res.type('text/xml');
    res.send(response.toString());
});

/**
 * @api {post} /process-speech Process speech and generate AI response
 * This webhook processes the user's speech with Gemini AI.
 */
app.post('/process-speech', async (req, res) => {
    const { SpeechResult } = req.body;
    const { name, appointmentDate, reason } = req.query;
    const { VoiceResponse } = twilio.twiml;
    const response = new VoiceResponse();

    if (!SpeechResult) {
        response.say("Sorry, I didn't catch that. Could you please repeat yourself?");
        response.redirect({ method: 'POST' }, '/initial-prompt');
        return res.type('text/xml').send(response.toString());
    }

    try {
        const prompt = `
            You are a friendly, multilingual AI appointment-setting assistant.
            A user is responding to an automated call. Your task is to generate a helpful and concise response in the SAME language as the user's input.

            **Appointment Context:**
            - Name: ${name}
            - Original Proposed Date: ${appointmentDate}
            - Reason: ${reason}

            **User's Spoken Response (transcribed):**
            "${SpeechResult}"

            **Your Instructions:**
            1.  **Detect Language:** Identify the language of the user's response.
            2.  **Analyze Intent:** Determine if the user is confirming, rescheduling, or asking a question.
            3.  **Generate Response:** Create a brief, polite response IN THE DETECTED LANGUAGE.
                - If confirmed, say: "Great, your appointment for ${appointmentDate} is confirmed. Thank you."
                - If rescheduling, say: "Okay, I've noted your request to reschedule. A staff member will contact you shortly to find a new time. Thank you."
                - If you cannot understand, say: "I'm sorry, I'm having trouble understanding. A staff member will call you back shortly."
            4.  **Do NOT add any introductory text. Just provide the raw text to be spoken.**
        `;

        const result = await geminiModel.generateContent(prompt);
        const geminiResponseText = await result.response.text();
        
        console.log(`User said: "${SpeechResult}" | AI replied: "${geminiResponseText}"`);
        
        response.say(geminiResponseText);
        response.say("Goodbye.");
        response.hangup();

    } catch (error) {
        console.error("Error generating content with Gemini:", error);
        response.say("I'm sorry, there was a system error. A staff member will call you back shortly. Goodbye.");
        response.hangup();
    }
    
    res.type('text/xml');
    res.send(response.toString());
});


// --- Start the Server ---
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
    if (!process.env.SERVER_BASE_URL) {
        console.warn("WARNING: SERVER_BASE_URL is not set. Twilio webhooks will fail unless you use ngrok and set the URL in your .env file.");
    }
});
