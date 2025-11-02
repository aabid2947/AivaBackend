// src/utils/elevenLabsClient.js
import { ElevenLabsClient } from "elevenlabs";

// Available voices for text-to-speech
export const VOICE_IDS = {
    SARAH: '21m00Tcm4TlvDq8ikWAM', // Rachel - warm female voice
    PROFESSIONAL: 'EXAVITQu4vr4xnSDxMaL', // Bella - professional female
    FRIENDLY: 'pNInz6obpgDQGcFmaJgB', // Adam - friendly neutral
};

// Initialize the official client
const elevenLabs = new ElevenLabsClient({
    apiKey: process.env.ELEVENLABS_API_KEY,
});

/**
 * Generate non-streaming speech.
 * This is used by the old twilioCallService.js as a fallback.
 * @param {string} text - The text to convert to speech
 * @param {string} voiceId - The voice ID to use
 * @returns {Promise<Buffer>} - A buffer of the audio data
 */
export async function generateSpeech(text, voiceId = VOICE_IDS.SARAH) {
    console.log(`[INFO] generateSpeech (non-streaming): Generating audio for: "${text.substring(0, 50)}..."`);
    
    try {
        const audioBuffer = await elevenLabs.textToSpeech.v1({
            text: text,
            voiceId: voiceId,
            modelId: "eleven_monolingual_v1",
            outputFormat: "mp3_44100_128",
            voiceSettings: {
                stability: 0.5,
                similarityBoost: 0.75,
            },
        });
        
        // The SDK returns the raw buffer directly
        return audioBuffer;

    } catch (error) {
        console.error('[ERROR] generateSpeech (non-streaming) failed:', error.message);
        throw error;
    }
}

/**
 * Generate speech and stream it.
 * @param {string} text - The text to convert to speech
 * @param {string} voiceId - The voice ID to use
 * @returns {Promise<ReadableStream>} - A readable stream of audio data
 */
export async function generateSpeechStream(text, voiceId = VOICE_IDS.SARAH) {
    console.log(`[INFO] generateSpeechStream: Streaming audio for: "${text.substring(0, 50)}..."`);
    
    try {
        const audioStream = await elevenLabs.textToSpeech.stream({
            text: text,
            voiceId: voiceId,
            modelId: "eleven_turbo_v2", // Use a fast model for streaming
            outputFormat: "mp3_44100_128",
            optimizeStreamingLatency: 3,
            voiceSettings: {
                stability: 0.5,
                similarityBoost: 0.75,
            },
        });

        // 🛠️ FIX: The official SDK's stream method *already* returns
        // a Node.js Readable stream. No conversion is needed.
        return audioStream;

    } catch (error) {
        console.error('[ERROR] generateSpeechStream failed:', error.message);
        throw error;
    }
}

/**
 * Initialize ElevenLabs client and validate API key
 */
export async function initializeElevenLabs() {
    if (!process.env.ELEVENLABS_API_KEY) {
        console.error('[ERROR] ELEVENLABS_API_KEY environment variable is not set.');
        return false;
    }
    
    try {
        console.log('[INFO] Testing ElevenLabs API connection...');
        const user = await elevenLabs.user.get();
        
        console.log('[INFO] ElevenLabs client initialized successfully.');
        console.log(`[INFO] Account: ${user.subscription?.tier || 'Free'}`);
        
        if (user.subscription) {
            const quota = user.subscription;
            console.log(`[INFO] Character quota: ${quota.character_count || 'Unknown'}/${quota.character_limit || 'Unknown'}`);
        }
        
        return true;
    } catch (error) {
        console.error('[ERROR] Failed to initialize ElevenLabs client:', error.message);
        return false;
    }
}

// Initialize on module load
initializeElevenLabs().catch(error => {
    console.error('[ERROR] ElevenLabs initialization failed:', error.message);
});