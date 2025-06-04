// src/controllers/aivaController.js
import * as aivaService from '../services/aivaServices.js'

export async function handleAivaInteraction(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated or user ID not found in token.' });
    }

    const { message } = req.body;
    // The "INITIATE_CONVERSATION_WITH_AIVA" is a valid message to start,
    // and other messages should be non-empty strings.
    if (!message || (typeof message === 'string' && message.trim() === '' && message !== "INITIATE_CONVERSATION_WITH_AIVA")) {
        if (message !== "INITIATE_CONVERSATION_WITH_AIVA") { // Allow the specific init message even if it were empty (though it's not)
            return res.status(400).json({ error: 'Message content is required and must be a non-empty string.' });
        }
    }

    // The aivaService.handleUserMessage will now be responsible for
    // determining if it's an initial interaction or an ongoing one.
    const responsePayload = await aivaService.handleUserMessage(userId, message);

    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error('Error in Aiva interaction controller:', error);
    if (error.message === 'Database not initialized. Check Firebase Admin setup.') {
        return res.status(503).json({ error: 'Service temporarily unavailable due to database issues.'});
    }
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}

