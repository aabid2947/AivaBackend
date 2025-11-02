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
        // Use the correct API method from the official SDK
        const audioBuffer = await elevenLabs.textToSpeech.convert(voiceId, {
            text: text,
            model_id: "eleven_monolingual_v1",
            output_format: "mp3_44100_128",
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
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
 * This is used by twilioCallServer.js for fast streaming.
 * @param {string} text - The text to convert to speech
 * @param {string} voiceId - The voice ID to use
 * @returns {Promise<ReadableStream>} - A readable stream of audio data
 */
export async function generateSpeechStream(text, voiceId = VOICE_IDS.SARAH) {
    console.log(`[ELEVENLABS] ========== Starting TTS Request ==========`);
    console.log(`[ELEVENLABS] Text: "${text.substring(0, 100)}${text.length > 100 ? '...' : ''}"`);
    console.log(`[ELEVENLABS] Text length: ${text.length} characters`);
    console.log(`[ELEVENLABS] Voice ID: ${voiceId}`);
    console.log(`[ELEVENLABS] Model: eleven_turbo_v2`);
    console.log(`[ELEVENLABS] Output format: mp3_44100_128`);
    
    try {
        // Use the correct streaming API method from the official SDK
        const audioStream = await elevenLabs.textToSpeech.convertAsStream(voiceId, {
            text: text,
            model_id: "eleven_turbo_v2",
            output_format: "mp3_44100_128",
            optimize_streaming_latency: 3,
            voice_settings: {
                stability: 0.5,
                similarity_boost: 0.75,
            },
        });

        console.log(`[ELEVENLABS] Stream received successfully`);
        console.log(`[ELEVENLABS] Stream type:`, audioStream ? audioStream.constructor.name : 'null');
        
        // Check if it's an async iterator
        if (audioStream && typeof audioStream[Symbol.asyncIterator] === 'function') {
            console.log(`[ELEVENLABS] Stream is an async iterator`);
        } else if (audioStream && typeof audioStream.on === 'function') {
            console.log(`[ELEVENLABS] Stream is a Node.js readable stream`);
        } else {
            console.log(`[ELEVENLABS] WARNING: Stream type is unexpected`);
        }

        // The official SDK's convertAsStream method returns a Node.js Readable stream
        return audioStream;

    } catch (error) {
        console.error(`[ELEVENLABS] ========== TTS Request FAILED ==========`);
        console.error('[ELEVENLABS] Error:', error.message);
        console.error('[ELEVENLABS] Error stack:', error.stack);
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