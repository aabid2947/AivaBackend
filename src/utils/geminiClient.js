// src/utils/geminiClient.js
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Ensure you have GEMINI_API_KEY in your .env file
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY is not set in .env file. GeminiClient will not function.');
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

const modelConfig = {
  // Adjust model name as needed, e.g., 'gemini-1.5-flash-latest' or 'gemini-pro'
  modelName: 'gemini-1.5-flash-latest', // Using a common capable model
  generationConfig: {
    temperature: 0.7, // Adjust for creativity vs. determinism
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048, // Adjust as needed
  },
  // Safety settings - adjust as per your application's needs
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  ],
};

/**
 * Generates content using the Gemini API.
 * @param {string} prompt The prompt to send to Gemini.
 * @param {Array<{role: string, parts: Array<{text: string}>}>} history Optional chat history.
 * @returns {Promise<string|null>} The generated text or null if an error occurs.
 */
export async function generateGeminiText(prompt, history = []) {
  if (!genAI) {
    console.error('Gemini API key not configured. Cannot generate text.');
    return null;
  }
  if (!GEMINI_API_KEY) { // Redundant check, but good for safety
      console.error('Gemini API key is missing.');
      return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: modelConfig.modelName });
    
    const chatParts = [
        ...history, // Spread existing history if any
        { role: "user", parts: [{ text: prompt }] }
    ];

    const result = await model.generateContent({
        contents: chatParts,
        generationConfig: modelConfig.generationConfig,
        safetySettings: modelConfig.safetySettings,
    });

    if (result && result.response && result.response.candidates && result.response.candidates.length > 0) {
      const candidate = result.response.candidates[0];
      if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
        return candidate.content.parts.map(part => part.text).join('');
      }
    }
    console.warn('Gemini API returned no content or unexpected structure:', result);
    return null; // Or a default message like "I'm having trouble understanding."
  } catch (error) {
    console.error('Error calling Gemini API:', error.message);
    // Log more details if available, e.g., error.response.data
    if (error.response && error.response.data) {
        console.error('Gemini API Error Details:', error.response.data);
    }
    return null; // Or throw error to be handled by caller
  }
}


