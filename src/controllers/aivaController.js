// src/controllers/aivaController.js
import * as aivaService from '../services/aivaServices.js';
import multer from 'multer';

// Setup multer for memory storage with file type filtering
const storage = multer.memoryStorage();

const fileFilter = (req, file, cb) => {
  const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'text/plain'];
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Unsupported file type. Please upload a JPEG, PNG, PDF, or TXT file.'), false);
  }
};

export const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
 limits: {
        fileSize: 50 * 1024 * 1024, // 50MB limit
        fieldSize: 50 * 1024 * 1024, // 50MB field size limit
    },
});


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

//  UPDATED Controller Function for Summarization 
export async function handleSummarizationRequest(req, res) {
    console.log("--- New Summarization Request Received ---");
    try {
        const userId = req.user?.id || req.user?.uid;
        if (!userId) {
            console.error("Authentication Error: User ID is missing from the request.");
            return res.status(401).json({ error: 'User not authenticated.' });
        }

        const { chatId } = req.params;
        const { message } = req.body;
        const file = req.file;

        console.log(`Request Details: Chat ID = ${chatId}, User ID = ${userId}`);

        if (!chatId) {
            console.error("Validation Error: Chat ID is missing from the URL parameters.");
            return res.status(400).json({ error: 'Chat ID is required in the URL path.' });
        }
        
        let responsePayload;

        if (file) {
            console.log("File detected in request.");
            console.log(`File Details: Name = ${file.originalname}, Type = ${file.mimetype}, Size = ${file.size} bytes`);
            
            if (file.mimetype.startsWith('image/')) {
                console.log(`Routing to image summarization service.`);
                responsePayload = await aivaService.performImageSummarization(userId, chatId, file);
            } else if (file.mimetype === 'application/pdf') {
                console.log(`Routing to PDF summarization service.`);
                responsePayload = await aivaService.performPdfSummarization(userId, chatId, file);
            } else { 
                console.log(`Routing to text file summarization service.`);
                const contentToSummarize = file.buffer.toString('utf-8');
                responsePayload = await aivaService.performSummarization(userId, chatId, contentToSummarize);
            }
        } else if (message) {
            console.log("Text message detected for summarization.");
            responsePayload = await aivaService.performSummarization(userId, chatId, message);
        } else {
            console.error("Validation Error: No file or message content was provided.");
            return res.status(400).json({ error: 'No content provided. Please supply a message or upload a file.' });
        }
        
        console.log("Summarization request processed successfully.");
        return res.status(200).json(responsePayload);

    } catch (error) {
        console.error('--- Critical Error in handleSummarizationRequest ---');
        console.error(`Error details: ${error.message}`);
        console.error(error.stack);

        if (error.message.includes('Unsupported file type')) {
            return res.status(400).json({ error: error.message });
        }
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
    console.log("called")
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

export async function getAivaChatMessages(req, res) {
  try {
    console.log("called")

    const userId = req.user?.id || req.user?.uid;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated.' });
    }
    const { chatId } = req.params;
    if (!chatId) {
      return res.status(400).json({ error: 'Chat ID is required in URL path.' });
    }
    const messages = await aivaService.getChatHistory(userId, chatId);
    return res.status(200).json({ messages });
  } catch (error) {
    console.error(`Error in getAivaChatMessages controller for chat ${req.params.chatId}:`, error);
    return res.status(500).json({ error: 'Failed to retrieve chat messages.' });
  }
}