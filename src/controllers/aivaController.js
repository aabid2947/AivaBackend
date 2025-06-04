// src/controllers/aivaController.js
import * as aivaService from '../services/aivaServices.js'

export async function handleAivaInteraction(req, res) {
  try {
    // Assuming JWT middleware has added req.user with an 'id' or 'uid' field for the user
    const userId = req.user?.id || req.user?.uid; 
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated or user ID not found in token.' });
    }

    const { message } = req.body;
    if (!message || typeof message !== 'string' || message.trim() === '') {
      return res.status(400).json({ error: 'Message content is required and must be a non-empty string.' });
    }

    // Check if this is the very first interaction for the user to send initial greeting
    let conversation = await aivaService.getConversation(userId);
    let responsePayload;

    if (conversation.currentState === aivaService.ConversationStates.INITIAL) {
        // The getConversation already handles sending the initial greeting if it's new.
        // We just need to return that greeting and update state.
        responsePayload = {
            aivaResponse: aivaService.AIVA_INITIAL_GREETING,
            currentState: aivaService.ConversationStates.AWAITING_USER_REQUEST, // State after greeting
            conversationId: conversation.id,
            userId: userId
        };
         // The service already updated the state when creating the initial conversation
    } else {
        responsePayload = await aivaService.handleUserMessage(userId, message);
    }

    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error('Error in Aiva interaction controller:', error);
    // More specific error handling can be added based on error types
    if (error.message === 'Database not initialized. Check Firebase Admin setup.') {
        return res.status(503).json({ error: 'Service temporarily unavailable due to database issues.'});
    }
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}

