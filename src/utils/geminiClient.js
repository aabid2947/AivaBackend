// src/utils/geminiClient.js
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';

// Ensure you have GEMINI_API_KEY in your .env file

let genAI = null; // Initialize as null

// Fetch API key from environment
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

try {
    console.log('Attempting to initialize GoogleGenerativeAI with API Key.');
    if (!GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY environment variable is not set.');
    }
    // Pass the API key directly to the constructor
    genAI = new GoogleGenerativeAI(GEMINI_API_KEY); 
    console.log('GoogleGenerativeAI client initialized successfully using API Key.');
} catch (error) {
    console.error('ERROR: Failed to initialize GoogleGenerativeAI client.');
    console.error('Please ensure the GEMINI_API_KEY environment variable is set in your .env file or deployment environment.');
    console.error('Initialization Error Details:', error.message);
    // genAI remains null, so subsequent calls to generation functions will log warnings.
}

// Optional: A final warning if initialization truly failed.
if (!genAI) {
  console.warn('WARNING: GeminiClient could not be configured. Gemini API calls will not function.');
}

// This model is multimodal and can handle both text and vision
const modelConfig = {
  modelName: 'gemini-1.5-flash-001',
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
  console.log(`[INFO] generateGeminiText: Called.`);
  if (!genAI) {
    console.error('[ERROR] generateGeminiText: Gemini API key not configured.');
    return null;
  }

  try {
    console.log(`[DEBUG] generateGeminiText: Prompt: "${prompt}"`);
    const model = genAI.getGenerativeModel({ model: modelConfig.modelName });
    
    const chatParts = [ ...history, { role: "user", parts: [{ text: prompt }] }];
    const result = await model.generateContent({
        contents: chatParts,
        generationConfig: modelConfig.generationConfig,
        safetySettings: modelConfig.safetySettings,
    });

    const responseText = result?.response?.candidates?.[0]?.content?.parts?.map(part => part.text).join('');
    
    if (responseText) {
        console.log(`[DEBUG] generateGeminiText: Raw response from API: "${responseText}"`);
        return responseText;
    }
    
    console.warn('[WARN] generateGeminiText: Gemini API returned no content or unexpected structure.', result);
    return "I'm having a little trouble thinking right now. Could you try rephrasing?";
  } catch (error) {
    console.error(`[ERROR] generateGeminiText: Error calling Gemini API: ${error.message}`);
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

/**
 * Lists available Gemini models using the GoogleGenerativeAI client.
 * @returns {Promise<Array|undefined>} Array of model objects or undefined if error.
 */

// --- NEW FUNCTION for Audio Transcription ---

export async function generateGeminiAudioTranscription(audioBuffer, audioMimeType) {
    console.log(`[INFO] generateGeminiAudioTranscription: Called for MIME type: ${audioMimeType}`);
    if (!genAI) {
        console.error('[ERROR] generateGeminiAudioTranscription: Gemini API key not configured.');
        return null;
    }

    try {
        const model = genAI.getGenerativeModel({ model: modelConfig.modelName });
        const audioPart = fileToGenerativePart(audioBuffer, audioMimeType);

        const prompt = "Transcribe the following audio recording accurately.";
        const result = await model.generateContent([prompt, audioPart]);
        const response = await result.response;
        const text = response.text();
        
        console.log(`[DEBUG] generateGeminiAudioTranscription: Transcription result: "${text}"`);
        return text;

    } catch (error) {
        console.error(`[ERROR] generateGeminiAudioTranscription: Error calling Gemini API: ${error.message}`);
        return null;
    }
}