// src/utils/speechToTextClient.js

import { SpeechClient } from '@google-cloud/speech'; // Import the Speech-to-Text client

// Initialize the Speech-to-Text client
// This assumes GOOGLE_APPLICATION_CREDENTIALS environment variable is set
// pointing to your service account key file.
const speechClient = new SpeechClient();

/**
 * Transcribes audio data to text using Google Speech-to-Text API.
 * @param {Buffer} audioBuffer - The audio data as a Buffer.
 * @param {string} encoding - The audio encoding (e.g., 'LINEAR16', 'FLAC', 'MP3').
 * @param {number} sampleRateHertz - The sample rate of the audio in Hertz.
 * @param {string} languageCode - The language code (e.g., 'en-US').
 * @returns {Promise<string>} The transcribed text.
 * @throws {Error} If transcription fails.
 */
export async function transcribeAudio(audioBuffer, encoding = 'LINEAR16', sampleRateHertz = 16000, languageCode = 'en-US') {
    try {
        const audio = {
            content: audioBuffer.toString('base64'), // Send audio as base64 encoded string
        };

        const config = {
            encoding: encoding,
            sampleRateHertz: sampleRateHertz,
            languageCode: languageCode,
            // Add any other specific configurations here, e.g., enableAutomaticPunctuation, model
            // model: 'default', // Can be 'default', 'command_and_search', 'phone_call', 'video'
        };

        const request = {
            audio: audio,
            config: config,
        };

        // Detects speech in the audio file
        const [response] = await speechClient.recognize(request);
        const transcription = response.results
            .map(result => result.alternatives[0].transcript)
            .join('\n');

        console.log(`Speech-to-Text Transcription: ${transcription}`);
        return transcription;

    } catch (error) {
        console.error('Error during Google Speech-to-Text transcription:', error);
        throw new Error('Failed to transcribe audio: ' + error.message);
    }
}
