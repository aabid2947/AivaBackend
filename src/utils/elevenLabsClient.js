// src/utils/elevenLabsClient.js
import axios from 'axios';
import WebSocket from 'ws';


const ELEVENLABS_AGENT_ID = process.env.ELEVENLABS_AGENT_ID; // You'll need to create an agent in ElevenLabs dashboard

// Base API configuration
const ELEVENLABS_API_BASE = 'https://api.elevenlabs.io/v1';

// Available voices for text-to-speech
const VOICE_IDS = {
    SARAH: '21m00Tcm4TlvDq8ikWAM', // Rachel - warm female voice
    PROFESSIONAL: 'EXAVITQu4vr4xnSDxMaL', // Bella - professional female
    FRIENDLY: 'pNInz6obpgDQGcFmaJgB', // Adam - friendly neutral
};

/**
 * Initialize ElevenLabs client and validate API key
 */
export async function initializeElevenLabs() {
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    
    if (!ELEVENLABS_API_KEY) {
        console.error('[ERROR] ELEVENLABS_API_KEY environment variable is not set.');
        console.error('[INFO] Please add ELEVENLABS_API_KEY to your .env file.');
        console.error('[INFO] System will fall back to Twilio TTS for voice generation.');
        return false;
    }

    // Validate API key format
    if (!ELEVENLABS_API_KEY.startsWith('sk_')) {
        console.error('[ERROR] Invalid ElevenLabs API key format. Key should start with "sk_"');
        console.error('[INFO] System will fall back to Twilio TTS for voice generation.');
        return false;
    }

    try {
        console.log('[INFO] Testing ElevenLabs API connection...');
        // Test API connection
        const response = await axios.get(`${ELEVENLABS_API_BASE}/user`, {
            headers: {
                'xi-api-key': ELEVENLABS_API_KEY,
            },
            timeout: 10000, // 10 second timeout
        });
        
        console.log('[INFO] ElevenLabs client initialized successfully.');
        console.log(`[INFO] Account: ${response.data.subscription?.tier || 'Free'}`);
        
        // Log quota information if available
        if (response.data.subscription) {
            const quota = response.data.subscription;
            console.log(`[INFO] Character quota: ${quota.character_count || 'Unknown'}/${quota.character_limit || 'Unknown'}`);
        }
        
        return true;
    } catch (error) {
        console.error('[ERROR] Failed to initialize ElevenLabs client:', error.message);
        
        if (error.response) {
            const status = error.response.status;
            const data = error.response.data;
            
            switch (status) {
                case 401:
                    console.error('[ERROR] Authentication failed - Invalid API key');
                    console.error('[INFO] Please verify your ElevenLabs API key is correct');
                    console.error('[INFO] Get a new key from: https://elevenlabs.io/app/settings/api-keys');
                    break;
                case 429:
                    console.error('[ERROR] Rate limit exceeded - Too many requests');
                    console.error('[INFO] Please wait before trying again');
                    break;
                case 402:
                    console.error('[ERROR] Quota exceeded - No more characters available');
                    console.error('[INFO] Upgrade your plan or wait for quota reset');
                    break;
                default:
                    console.error(`[ERROR] API Error ${status}:`, data?.detail || 'Unknown error');
            }
        } else if (error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
            console.error('[ERROR] Network connection failed - Check internet connectivity');
        } else if (error.code === 'ECONNABORTED') {
            console.error('[ERROR] Request timeout - ElevenLabs API is slow or unavailable');
        }
        
        console.error('[INFO] System will fall back to Twilio TTS for voice generation.');
        return false;
    }
}

/**
 * Generate speech from text using ElevenLabs TTS API
 * @param {string} text - The text to convert to speech
 * @param {string} voiceId - The voice ID to use (default: SARAH)
 * @returns {Promise<Buffer>} Audio buffer
 */
export async function generateSpeech(text, voiceId = VOICE_IDS.SARAH) {
    console.log(`[INFO] generateSpeech: Generating audio for: "${text.substring(0, 50)}..."`);
    
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key not configured');
    }

    try {
        const response = await axios.post(
            `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}`,
            {
                text,
                model_id: 'eleven_monolingual_v1',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0.5,
                    use_speaker_boost: true,
                },
            },
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                    Accept: 'audio/mpeg',
                },
                responseType: 'arraybuffer',
                timeout: 30000, // 30 second timeout for audio generation
            }
        );

        console.log('[INFO] generateSpeech: Audio generated successfully.');
        return Buffer.from(response.data);
    } catch (error) {
        console.error('[ERROR] generateSpeech failed:', error.message);
        
        if (error.response) {
            const status = error.response.status;
            switch (status) {
                case 401:
                    console.error('[ERROR] Authentication failed during speech generation');
                    break;
                case 402:
                    console.error('[ERROR] Quota exceeded during speech generation');
                    break;
                case 422:
                    console.error('[ERROR] Invalid request - check text content and voice ID');
                    break;
            }
        }
        
        throw error;
    }
}

/**
 * Generate speech and stream directly to Twilio
 * @param {string} text - The text to convert to speech
 * @param {string} voiceId - The voice ID to use
 * @returns {Promise<string>} URL to the audio stream
 */
export async function generateSpeechStream(text, voiceId = VOICE_IDS.SARAH) {
    console.log(`[INFO] generateSpeechStream: Streaming audio for: "${text.substring(0, 50)}..."`);
    
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key not configured');
    }

    try {
        const response = await axios.post(
            `${ELEVENLABS_API_BASE}/text-to-speech/${voiceId}/stream`,
            {
                text,
                model_id: 'eleven_turbo_v2', // Faster model for streaming
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75,
                },
            },
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                    Accept: 'audio/mpeg',
                },
                responseType: 'stream',
                timeout: 30000,
            }
        );

        return response.data;
    } catch (error) {
        console.error('[ERROR] generateSpeechStream failed:', error.message);
        throw error;
    }
}

/**
 * Create a conversational AI agent session
 * This is the main function for real-time conversations
 * @param {string} agentId - The ElevenLabs agent ID
 * @param {object} context - Conversation context data
 * @returns {Promise<object>} WebSocket connection info
 */
export async function createConversationalSession(agentId, context = {}) {
    console.log('[INFO] createConversationalSession: Creating session with agent:', agentId);
    
    const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
    if (!ELEVENLABS_API_KEY) {
        throw new Error('ElevenLabs API key not configured');
    }

    if (!agentId) {
        throw new Error('Agent ID is required for conversational sessions');
    }

    try {
        // Create a signed URL for WebSocket connection
        const response = await axios.post(
            `${ELEVENLABS_API_BASE}/convai/conversation`,
            {
                agent_id: agentId,
                // Pass custom context that the agent can use
                custom_llm_extra_body: {
                    context,
                },
            },
            {
                headers: {
                    'xi-api-key': ELEVENLABS_API_KEY,
                    'Content-Type': 'application/json',
                },
                timeout: 15000,
            }
        );

        console.log('[INFO] Conversational session created:', response.data.conversation_id);
        return {
            conversationId: response.data.conversation_id,
            signedUrl: response.data.signed_url,
        };
    } catch (error) {
        console.error('[ERROR] createConversationalSession failed:', error.message);
        throw error;
    }
}

/**
 * Connect to ElevenLabs conversational AI via WebSocket
 * @param {string} signedUrl - The signed WebSocket URL
 * @param {function} onMessage - Callback for receiving messages
 * @param {function} onError - Callback for errors
 * @returns {WebSocket} WebSocket connection
 */
export function connectConversationalWebSocket(signedUrl, onMessage, onError) {
    console.log('[INFO] Connecting to ElevenLabs WebSocket...');
    
    const ws = new WebSocket(signedUrl);
    
    ws.on('open', () => {
        console.log('[INFO] ElevenLabs WebSocket connected successfully');
    });
    
    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            console.log('[DEBUG] WebSocket message received:', message.type);
            if (onMessage) onMessage(message);
        } catch (error) {
            console.error('[ERROR] Failed to parse WebSocket message:', error.message);
        }
    });
    
    ws.on('error', (error) => {
        console.error('[ERROR] WebSocket error:', error.message);
        if (onError) onError(error);
    });
    
    ws.on('close', (code, reason) => {
        console.log(`[INFO] WebSocket closed: ${code} - ${reason}`);
    });
    
    return ws;
}

/**
 * Send audio to the conversational AI agent
 * @param {WebSocket} ws - The WebSocket connection
 * @param {Buffer} audioBuffer - Audio data to send
 */
export function sendAudioToAgent(ws, audioBuffer) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'audio',
            audio: audioBuffer.toString('base64'),
        }));
    } else {
        console.error('[ERROR] Cannot send audio: WebSocket not open');
    }
}

/**
 * Send text to the conversational AI agent
 * @param {WebSocket} ws - The WebSocket connection
 * @param {string} text - Text message to send
 */
export function sendTextToAgent(ws, text) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'text',
            text,
        }));
    } else {
        console.error('[ERROR] Cannot send text: WebSocket not open');
    }
}

/**
 * Update agent context during conversation
 * @param {WebSocket} ws - The WebSocket connection
 * @param {object} context - Updated context data
 */
export function updateAgentContext(ws, context) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
            type: 'context_update',
            context,
        }));
    } else {
        console.error('[ERROR] Cannot update context: WebSocket not open');
    }
}

/**
 * Close the conversational session
 * @param {WebSocket} ws - The WebSocket connection
 */
export function closeConversationalSession(ws) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
        console.log('[INFO] Conversational session closed');
    }
}

// Export voice IDs for use in other modules
export { VOICE_IDS };

// Initialize on module load
initializeElevenLabs().catch(error => {
    console.error('[ERROR] ElevenLabs initialization failed:', error.message);
});
