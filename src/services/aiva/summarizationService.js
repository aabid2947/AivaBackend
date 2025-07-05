// src/services/aiva/summarization.service.js
import { db } from '../../config/firebaseAdmin.js';
import { generateGeminiText, generateGeminiVisionResponse } from '../../utils/geminiClient.js';
import { addMessageToHistory } from './chatService.js';
import { updateConversationState } from './conversationService.js';
import { getSummarizationPrompt, getVisionSummarizationPrompt } from './prompts.js';
import { ConversationStates } from './constants.js';

export async function performSummarization(userId, chatId, textToSummarize) {
  if (!db) throw new Error('Database not initialized.');
  await addMessageToHistory(userId, chatId, 'user', '[Content provided for summarization]', ConversationStates.AWAITING_CONTENT_FOR_SUMMARY);
  
  const prompt = getSummarizationPrompt(textToSummarize);
  const summaryResponse = await generateGeminiText(prompt);
  
  const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', summaryResponse, ConversationStates.AWAITING_USER_REQUEST);
  await updateConversationState(userId, chatId, ConversationStates.AWAITING_USER_REQUEST, { lastProposedIntent: null, lastAivaMessageId: aivaMessageRef.id });
  
  console.log(`summarization.service: Text summarization complete for chat ${chatId}.`);
  return {
    id: aivaMessageRef.id,
    aivaResponse: summaryResponse,
    currentState: ConversationStates.AWAITING_USER_REQUEST,
    chatId: chatId,
    userId: userId,
  };
}

export async function performPdfSummarization(userId, chatId, file) {
  if (!db) throw new Error('Database not initialized.');
  
  try {
    const pdf = (await import('pdf-parse')).default;
    const data = await pdf(file.buffer);
    const textToSummarize = data.text;

    if (!textToSummarize) {
      throw new Error("Could not extract text from the PDF. It may be an image-based PDF.");
    }

    return await performSummarization(userId, chatId, textToSummarize);

  } catch (error) {
    console.error('Failed to parse PDF:', error);
    const errorMessage = "I couldn't extract text from this PDF. It might be an image or a scanned document, which I can't summarize yet.";
    const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', errorMessage, ConversationStates.AWAITING_USER_REQUEST);
    await updateConversationState(userId, chatId, ConversationStates.AWAITING_USER_REQUEST, { lastProposedIntent: null, lastAivaMessageId: aivaMessageRef.id });
    return {
      id: aivaMessageRef.id,
      aivaResponse: errorMessage,
      currentState: ConversationStates.AWAITING_USER_REQUEST,
      chatId,
      userId,
    };
  }
}

export async function performImageSummarization(userId, chatId, file) {
  if (!db) throw new Error('Database not initialized.');
  
  await addMessageToHistory(userId, chatId, 'user', `[Image uploaded: ${file.originalname}]`, ConversationStates.AWAITING_CONTENT_FOR_SUMMARY);
  
  const prompt = getVisionSummarizationPrompt();
  const summaryResponse = await generateGeminiVisionResponse(prompt, file.buffer, file.mimetype);
  
  const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', summaryResponse, ConversationStates.AWAITING_USER_REQUEST);
  await updateConversationState(userId, chatId, ConversationStates.AWAITING_USER_REQUEST, { lastProposedIntent: null, lastAivaMessageId: aivaMessageRef.id });
  
  console.log(`summarization.service: Image summarization complete for chat ${chatId}.`);
  return {
    id: aivaMessageRef.id,
    aivaResponse: summaryResponse,
    currentState: ConversationStates.AWAITING_USER_REQUEST,
    chatId,
    userId,
  };
}
