// src/routes/twilioRoutes.js

import { Router } from 'express';
import twilio from 'twilio';
import { GoogleGenerativeAI } from '@google/generative-ai';

const router = Router();

// --- Client Initialization ---
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const geminiModel = genAI.getGenerativeModel({ model: "gemini-pro" });

/**
 * Service function to place the call via Twilio.
 */
async function initiateAppointmentCall({ phoneNumber, name, appointmentDate, reason }) {
  const initialPromptUrl = new URL(`${process.env.SERVER_BASE_URL}/api/twilio/initial-prompt`);
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
    throw new Error('Failed to initiate Twilio call.');
  }
}

// --- API Endpoints ---

/**
 * @route   POST /api/twilio/start-appointment-call
 * @desc    Initiates the appointment call
 */
router.post('/start-appointment-call', async (req, res) => {
  const { phoneNumber, name, appointmentDate, reason } = req.body;

  if (!phoneNumber || !name || !appointmentDate || !reason) {
    return res.status(400).json({ success: false, message: 'Missing required appointment details.' });
  }

  try {
    const call = await initiateAppointmentCall({ phoneNumber, name, appointmentDate, reason });
    res.status(200).json({
      success: true,
      message: 'Appointment call has been successfully initiated.',
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
 * @route   POST /api/twilio/initial-prompt
 * @desc    Webhook for Twilio when the person answers the phone.
 */
router.post('/initial-prompt', (req, res) => {
  const { name, appointmentDate, reason } = req.query;
  const { VoiceResponse } = twilio.twiml;
  const response = new VoiceResponse();

  const gather = response.gather({
    input: 'speech',
    action: `/api/twilio/process-speech?name=${encodeURIComponent(name)}&appointmentDate=${encodeURIComponent(appointmentDate)}&reason=${encodeURIComponent(reason)}`,
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
 * @route   POST /api/twilio/process-speech
 * @desc    Webhook for Twilio. Processes the user's spoken response using Gemini AI.
 */
router.post('/process-speech', async (req, res) => {
  const { SpeechResult } = req.body;
  const { name, appointmentDate, reason } = req.query;
  const { VoiceResponse } = twilio.twiml;
  const response = new VoiceResponse();

  if (!SpeechResult) {
    response.say("Sorry, I did not catch that. Please repeat yourself.");
    response.redirect({ method: 'POST' }, '/api/twilio/initial-prompt');
    return res.type('text/xml').send(response.toString());
  }

  try {
    const prompt = `
You are a friendly, multilingual AI appointment-setting assistant.
A user is responding to an automated call. Your task is to generate a helpful and concise response in the SAME language as the user's input.

**
Appointment Context:
- Name: ${name}
- Original Proposed Date: ${appointmentDate}
- Reason: ${reason}

User's Spoken Response (transcribed):
"${SpeechResult}"

Instructions:
1. Detect Language: Identify the language of the user's response.
2. Analyze Intent: Determine if the user is confirming, rescheduling, or asking a question.
3. Generate Response: Create a brief, polite response IN THE DETECTED LANGUAGE.
   - If confirmed, say: "Great, your appointment for ${appointmentDate} is confirmed. Thank you."
   - If rescheduling, say: "Okay, I've noted your request to reschedule. A staff member will contact you shortly to find a new time. Thank you."
   - If you cannot understand, say: "I'm sorry, I'm having trouble understanding. A staff member will call you back shortly."
4. Do NOT add any introductory text. Just provide the raw text to be spoken.
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

export default router;
