// src/services/aiva/summarization.service.js
import { db } from '../../config/firebaseAdmin.js';
import { generateGeminiText, generateGeminiVisionResponse } from '../../utils/geminiClient.js';
import { addMessageToHistory } from './chatService.js';
import { updateConversationState } from './conversationService.js';
import { getSummarizationPrompt, getVisionSummarizationPrompt } from './prompts.js';
import { ConversationStates } from './constants.js';
// import pdf from 'pdf-parse'; 
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

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
    pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';
    console.log("PDF.js worker source configured.");

    const doc = await pdfjs.getDocument({ data: new Uint8Array(file.buffer) }).promise;
    console.log(`PDF document loaded successfully. It has ${doc.numPages} pages.`);
    
    let fullText = '';
    for (let i = 1; i <= doc.numPages; i++) {
      console.log(`Processing page ${i}...`);
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n';
      console.log(`Extracted ${pageText.length} characters from page ${i}.`);
    }

    if (!fullText.trim()) {
        console.warn("Warning: No text could be extracted from the PDF. It might be an image-based file.");
        throw new Error("Could not extract text from the PDF. It may be an image-based PDF.");
    }

    console.log(`Total extracted text length from PDF: ${fullText.length}. Proceeding with summarization.`);
    return await performSummarization(userId, chatId, fullText);

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