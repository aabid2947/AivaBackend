// src/utils/geminiClient.js
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Ensure you have GEMINI_API_KEY in your .env file
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
  console.warn('GEMINI_API_KEY is not set in .env file. GeminiClient will not function.');
}

const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// This model is multimodal and can handle both text and vision
const modelConfig = {
  modelName: 'gemini-1.5-flash-latest',
  generationConfig: {
    temperature: 0.7,
    topK: 1,
    topP: 1,
    maxOutputTokens: 2048,
  },
  safetySettings: [
    { category: HarmCategory.HARM_CATEGORY_HARASSMENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
    { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  ],
};

/**
 * Converts a file buffer to a Gemini-compatible FileData part.
 * @param {Buffer} buffer The file buffer.
 * @param {string} mimeType The MIME type of the file.
 * @returns {{inlineData: {data: string, mimeType: string}}}
 */
function fileToGenerativePart(buffer, mimeType) {
  return {
    inlineData: {
      data: buffer.toString("base64"),
      mimeType
    },
  };
}


/**
 * Generates content using the Gemini API for text-only prompts.
 * @param {string} prompt The prompt to send to Gemini.
 * @param {Array<{role: string, parts: Array<{text: string}>}>} history Optional chat history.
 * @returns {Promise<string|null>} The generated text or null if an error occurs.
 */
export async function generateGeminiText(prompt, history = []) {
  if (!genAI) {
    console.error('Gemini API key not configured. Cannot generate text.');
    return null;
  }

  try {
    const model = genAI.getGenerativeModel({ model: modelConfig.modelName });
    
    const chatParts = [
        ...history,
        { role: "user", parts: [{ text: prompt }] }
    ];

    const result = await model.generateContent({
        contents: chatParts,
        generationConfig: modelConfig.generationConfig,
        safetySettings: modelConfig.safetySettings,
    });

    if (result?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
        return result.response.candidates[0].content.parts.map(part => part.text).join('');
    }
    
    console.warn('Gemini API (text) returned no content or unexpected structure:', result);
    return "I'm having a little trouble thinking right now. Could you try rephrasing?";
  } catch (error) {
    console.error('Error calling Gemini API (text):', error.message);
    return null;
  }
}

/**
 * Generates content using the Gemini API for prompts that include an image.
 * @param {string} prompt The text part of the prompt.
 * @param {Buffer} imageBuffer The buffer of the image file.
 * @param {string} imageMimeType The MIME type of the image.
 * @returns {Promise<string|null>} The generated text or null if an error occurs.
 */
export async function generateGeminiVisionResponse(prompt, imageBuffer, imageMimeType) {
    if (!genAI) {
        console.error('Gemini API key not configured. Cannot generate vision response.');
        return null;
    }

    try {
        // The same model can handle multimodal inputs
        const model = genAI.getGenerativeModel({ model: modelConfig.modelName });

        const imagePart = fileToGenerativePart(imageBuffer, imageMimeType);

        const result = await model.generateContent([prompt, imagePart]);
        
        if (result?.response?.candidates?.[0]?.content?.parts?.[0]?.text) {
            return result.response.candidates[0].content.parts.map(part => part.text).join('');
        }

        console.warn('Gemini API (vision) returned no content or unexpected structure:', result);
        return "I'm having trouble analyzing the image. Please try again with a different one.";
    } catch (error) {
        console.error('Error calling Gemini API (vision):', error.message);
        return null;
    }
}