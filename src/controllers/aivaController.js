// src/controllers/aivaController.js
import * as aivaService from '../services/aivaServices.js'

export async function performCreateNewAivaChat(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated.' });
    }
    // chatName could optionally come from req.body if you want to allow naming
    const newChatData = await aivaService.createNewChat(userId, "New Chat");
    return res.status(201).json(newChatData); // 201 Created
  } catch (error) {
    console.error('Error in performCreateNewAivaChat controller:', error);
    return res.status(500).json({ error: 'Failed to create new chat.' });
  }
}

export async function handleAivaChatInteraction(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated.' });
    }

    const { chatId, message } = req.body; // Expect chatId in the body now

    if (!chatId) {
        return res.status(400).json({ error: 'chatId is required.' });
    }
    if (!message || typeof message !== 'string' || message.trim() === '') {
        return res.status(400).json({ error: 'Message content is required.' });
    }

    const responsePayload = await aivaService.handleUserMessage(userId, chatId, message);
    if (responsePayload.error && responsePayload.error === "Conversation not found") {
        return res.status(404).json({ error: "Chat session not found. It might have been deleted or the ID is incorrect."});
    }
    return res.status(200).json(responsePayload);

  } catch (error) {
    console.error('Error in handleAivaChatInteraction controller:', error);
    return res.status(500).json({ error: 'An internal server error occurred.' });
  }
}

export async function performDeleteAivaChat(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated.' });
    }
    const { chatId } = req.params; // Get chatId from URL parameters
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required in URL path.' });
    }

    await aivaService.deleteChat(userId, chatId);
    return res.status(200).json({ message: `Chat ${chatId} deleted successfully.` }); // Or 204 No Content
  } catch (error) {
    console.error('Error in performDeleteAivaChat controller:', error);
    // Check if error is due to chat not found, could return 404
    return res.status(500).json({ error: 'Failed to delete chat.' });
  }
}

