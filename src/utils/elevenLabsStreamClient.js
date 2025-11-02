// src/utils/elevenLabsStreamClient.js
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
 */
export async function generateSpeech(text, voiceId = VOICE_IDS.SARAH) {
    console.log(`[INFO] generateSpeech (non-streaming): Generating audio for: "${text.substring(0, 50)}..."`);
    
    try {
        // 🛠️ FIX: The correct method is .v1()
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
        
        return audioBuffer;

    } catch (error) {
        console.error('[ERROR] generateSpeech (non-streaming) failed:', error.message);
        throw error;
    }
}

/**
 * Generate speech and stream it.
 * This is used by twilioCallServer.js for fast streaming.
 */
export async function generateSpeechStream(text, voiceId = VOICE_IDS.SARAH) {
    console.log(`[INFO] generateSpeechStream: Streaming audio for: "${text.substring(0, 50)}..."`);
    
    try {
        // 🛠️ FIX: The correct method is .stream.v1()
        const audioStream = await elevenLabs.textToSpeech.stream.v1({
            text: text,
            voiceId: voiceId,
            modelId: "eleven_turbo_v2",
            outputFormat: "mp3_44100_128",
            optimizeStreamingLatency: 3,
            voiceSettings: {
                stability: 0.5,
                similarityBoost: 0.75,
            },
        });

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