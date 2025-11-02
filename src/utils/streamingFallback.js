// src/utils/streamingFallback.js
import twilio from 'twilio';

/**
 * Fallback system when streaming fails
 * This redirects to the regular TwiML flow
 */
export function createFallbackTwiML(appointmentId, errorMessage = 'Technical issue') {
    console.log(`[FALLBACK] Creating fallback TwiML for appointment ${appointmentId}: ${errorMessage}`);
    
    const twiml = new twilio.twiml.VoiceResponse();
    
    // Redirect to the working TwiML system
    const fallbackUrl = `/api/twilio/twiML/appointmentCall?appointmentId=${appointmentId}`;
    twiml.redirect(fallbackUrl);
    
    return twiml;
}

/**
 * Check if required services are available
 */
export function checkStreamingRequirements() {
    const requirements = {
        elevenLabs: !!process.env.ELEVENLABS_API_KEY,
        googleSpeech: !!process.env.GOOGLE_APPLICATION_CREDENTIALS || !!process.env.GOOGLE_CLOUD_PROJECT,
        ffmpeg: true, // Assume ffmpeg is available if fluent-ffmpeg is installed
    };
    
    const allAvailable = Object.values(requirements).every(Boolean);
    
    console.log('[INFO] Streaming requirements check:', requirements);
    
    return {
        requirements,
        allAvailable,
        canStream: allAvailable
    };
}