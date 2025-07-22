// src/services/aiva/summarization.service.js
import { db } from '../../config/firebaseAdmin.js';
import { generateGeminiText, generateGeminiVisionResponse } from '../../utils/geminiClient.js';
import { addMessageToHistory } from './chatService.js';
import { updateConversationState } from './conversationService.js';
import { getSummarizationPrompt, getVisionSummarizationPrompt } from './prompts.js';
import { ConversationStates } from './constants.js';
// import pdf from 'pdf-parse'; 

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
    // pdfjs-dist requires a "worker" to be specified, even in Node.js. This is the correct way to do it.
    pdfjs.GlobalWorkerOptions.workerSrc = 'pdfjs-dist/legacy/build/pdf.worker.mjs';

    // Load the document from the raw buffer you get from multer
    const doc = await pdfjs.getDocument({ data: file.buffer }).promise;
    let fullText = '';

    // Iterate through each page of the PDF
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const textContent = await page.getTextContent();
      
      // Join the text items from the page into a single string
      const pageText = textContent.items.map(item => item.str).join(' ');
      fullText += pageText + '\n'; // Append the page's text
    }

    if (!fullText.trim()) {
      throw new Error("Could not extract text from the PDF. It may be an image-based PDF.");
    }

    // Now, pass the extracted text to your existing summarization service
    return await performSummarization(userId, chatId, fullText);

  } catch (error) {
    console.error('Failed to parse PDF with pdfjs-dist:', error);
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