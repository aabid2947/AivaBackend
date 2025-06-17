// src/controllers/aivaController.js
import * as aivaService from '../services/aivaServices.js'; // Corrected filename
import multer from 'multer';

// Setup multer for memory storage to handle file buffer directly
const storage = multer.memoryStorage();
export const upload = multer({ storage: storage });


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

// New Controller Function for Summarization
export async function handleSummarizationRequest(req, res) {
    try {
        const userId = req.user?.id || req.user?.uid;
        if (!userId) {
            return res.status(401).json({ error: 'User not authenticated.' });
        }

        const { chatId } = req.params;
        const { message } = req.body;
        const file = req.file;

        if (!chatId) {
            return res.status(400).json({ error: 'Chat ID is required in the URL path.' });
        }

        let contentToSummarize = '';

        if (file) {
            // NOTE: This assumes the file is plain text (e.g., .txt).
            // For other file types like PDF or DOCX, you would need to install and use
            // additional libraries like 'pdf-parse' or 'mammoth'.
            console.log(`Summarizing uploaded file: ${file.originalname}`);
            contentToSummarize = file.buffer.toString('utf-8');
        } else if (message) {
            console.log(`Summarizing text message.`);
            contentToSummarize = message;
        }

        if (!contentToSummarize) {
            return res.status(400).json({ error: 'No content provided. Please supply a message or upload a file.' });
        }
        
        const responsePayload = await aivaService.performSummarization(userId, chatId, contentToSummarize);
        return res.status(200).json(responsePayload);

    } catch (error) {
        console.error('Error in handleSummarizationRequest controller:', error);
        return res.status(500).json({ error: 'An internal server error occurred during summarization.' });
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