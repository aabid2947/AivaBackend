// src/services/aiva/summarization.service.js
import { db } from '../../config/firebaseAdmin.js';
import { generateGeminiText, generateGeminiVisionResponse } from '../../utils/geminiClient.js';
import { addMessageToHistory } from './chatService.js';
import { updateConversationState } from './conversationService.js';
import { getSummarizationPrompt, getVisionSummarizationPrompt } from './prompts.js';
import { ConversationStates } from './constants.js';

// For PDFs, we'll use Gemini Vision API directly since PDF text extraction
// can be problematic in serverless environments

export async function performSummarization(userId, chatId, textToSummarize) {
  console.log(`Starting text summarization for Chat ID: ${chatId}`);
  if (!db) throw new Error('Database not initialized.');
  
  await addMessageToHistory(userId, chatId, 'user', '[Content provided for summarization]', ConversationStates.AWAITING_CONTENT_FOR_SUMMARY);
  
  const prompt = getSummarizationPrompt(textToSummarize);
  console.log(`Summarization prompt created. Text length: ${textToSummarize.length}`);
  
  const summaryResponse = await generateGeminiText(prompt);
  console.log("Successfully received summary from Gemini.");
  
  const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', summaryResponse, ConversationStates.AWAITING_USER_REQUEST);
  await updateConversationState(userId, chatId, ConversationStates.AWAITING_USER_REQUEST, { lastProposedIntent: null, lastAivaMessageId: aivaMessageRef.id });
  
  console.log(`Text summarization complete for chat ${chatId}.`);
  return {
    id: aivaMessageRef.id,
    aivaResponse: summaryResponse,
    currentState: ConversationStates.AWAITING_USER_REQUEST,
    chatId: chatId,
    userId: userId,
  };
}

export async function performPdfSummarization(userId, chatId, file) {
  console.log(`Starting PDF summarization for Chat ID: ${chatId}, File: ${file.originalname}`);
  if (!db) throw new Error('Database not initialized.');

  try {
    console.log("Processing PDF using Gemini Vision API...");

    // Use Gemini Vision to analyze the PDF directly
    const prompt = getVisionSummarizationPrompt("This is a PDF document. Please extract and summarize the key information from this document.");
    const summaryResponse = await generateGeminiVisionResponse(prompt, file.buffer, file.mimetype);
    
    if (!summaryResponse) {
      throw new Error("Could not process the PDF document.");
    }

    console.log("Successfully processed PDF with Gemini Vision API.");
    
    await addMessageToHistory(userId, chatId, 'user', `[PDF Document: ${file.originalname}]`, ConversationStates.AWAITING_CONTENT_FOR_SUMMARY);
    const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', summaryResponse, ConversationStates.AWAITING_USER_REQUEST);
    await updateConversationState(userId, chatId, ConversationStates.AWAITING_USER_REQUEST, { lastProposedIntent: null, lastAivaMessageId: aivaMessageRef.id });

    console.log(`PDF summarization complete for chat ${chatId}.`);
    return {
      id: aivaMessageRef.id,
      aivaResponse: summaryResponse,
      currentState: ConversationStates.AWAITING_USER_REQUEST,
      chatId: chatId,
      userId: userId,
    };

  } catch (error) {
    console.error('--- Error during PDF processing ---');
    console.error(`Error details for file ${file.originalname}: ${error.message}`);
    console.error(error.stack);
    
    const userErrorMessage = "I couldn't extract text from this PDF. It might be an image or a scanned document, which I can't summarize yet.";
    const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', userErrorMessage, ConversationStates.AWAITING_USER_REQUEST);
    await updateConversationState(userId, chatId, ConversationStates.AWAITING_USER_REQUEST, { lastProposedIntent: null, lastAivaMessageId: aivaMessageRef.id });
    
    return {
      id: aivaMessageRef.id,
      aivaResponse: userErrorMessage,
      currentState: ConversationStates.AWAITING_USER_REQUEST,
      chatId,
      userId,
    };
  }
}

export async function performImageSummarization(userId, chatId, file) {
  console.log(`Starting image summarization for Chat ID: ${chatId}, File: ${file.originalname}`);
  if (!db) throw new Error('Database not initialized.');
  
  await addMessageToHistory(userId, chatId, 'user', `[Image uploaded: ${file.originalname}]`, ConversationStates.AWAITING_CONTENT_FOR_SUMMARY);
  
  const prompt = getVisionSummarizationPrompt();
  console.log("Vision summarization prompt created.");
  
  const summaryResponse = await generateGeminiVisionResponse(prompt, file.buffer, file.mimetype);
  console.log("Successfully received vision summary from Gemini.");
  
  const aivaMessageRef = await addMessageToHistory(userId, chatId, 'assistant', summaryResponse, ConversationStates.AWAITING_USER_REQUEST);
  await updateConversationState(userId, chatId, ConversationStates.AWAITING_USER_REQUEST, { lastProposedIntent: null, lastAivaMessageId: aivaMessageRef.id });
  
  console.log(`Image summarization complete for chat ${chatId}.`);
  return {
    id: aivaMessageRef.id,
    aivaResponse: summaryResponse,
    currentState: ConversationStates.AWAITING_USER_REQUEST,
    chatId,
    userId,
  };
}