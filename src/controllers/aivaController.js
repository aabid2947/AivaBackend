// src/controllers/aivaController.js
import * as aivaService from '../services/aivaServices.js'; // Corrected filename

export async function performCreateNewAivaChat(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated.' });
    }
    const newChatData = await aivaService.createNewChat(userId, "New Chat");
    return res.status(201).json(newChatData);
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

    const { chatId, message } = req.body;

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
    const { chatId } = req.params;
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required in URL path.' });
    }

    await aivaService.deleteChat(userId, chatId);
    return res.status(200).json({ message: `Chat ${chatId} deleted successfully.` });
  } catch (error) {
    console.error('Error in performDeleteAivaChat controller:', error);
    return res.status(500).json({ error: 'Failed to delete chat.' });
  }
}

export async function listUserAivaChats(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated.' });
    }
    const chats = await aivaService.listUserChats(userId);
    return res.status(200).json({ chats });
  } catch (error) {
    console.error('Error in listUserAivaChats controller:', error);
    return res.status(500).json({ error: 'Failed to retrieve chats.' });
  }
}

// New function to get messages for a specific chat
export async function getAivaChatMessages(req, res) {
  try {
    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated.' });
    }
    const { chatId } = req.params;
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required in URL path.' });
    }
    // You can add a limit from query params if needed, e.g., req.query.limit
    const messages = await aivaService.getChatHistory(userId, chatId);
    return res.status(200).json({ messages }); // Send as { messages: [...] } to match frontend expectation
  } catch (error) {
    console.error(`Error in getAivaChatMessages controller for chat ${req.params.chatId}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve chat messages.' });
  }
}
