// src/services/streamingCallServer.js
import { WebSocketServer } from 'ws';
import { SpeechClient } from '@google-cloud/speech';
import ffmpeg from 'fluent-ffmpeg';
import { PassThrough } from 'stream';
import { generateChatgptText, generateChatgptTextStream } from '../utils/chatgptClient.js';
import { generateSpeech, generateSpeechStream, VOICE_IDS } from '../utils/elevenLabsStreamClient.js';
import { db, admin } from '../config/firebaseAdmin.js';
import ffmpegStatic from 'ffmpeg-static';

ffmpeg.setFfmpegPath(ffmpegStatic);

// Workaround STT: do not use Google Speech client here.
// Instead we buffer incoming μ-law audio and transcribe using OpenAI Whisper
// when available, or save audio for offline processing.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

async function mulawBufferToWavBuffer(mulawBuffer) {
    return new Promise((resolve, reject) => {
        try {
            const ff = spawn('ffmpeg', [
                '-f', 'mulaw',
                '-ar', '8000',
                '-ac', '1',
                '-i', 'pipe:0',
                '-ar', '16000',
                '-ac', '1',
                '-f', 'wav',
            // Simple buffer-based STT stream fallback.
            // We collect incoming μ-law audio chunks and, after a short silence (inactivity),
            // convert the buffer to WAV and call OpenAI Whisper (if available). If OpenAI
            // is not available, we save the raw buffer to disk for offline processing.

            let sttBuffer = [];
            let inactivityTimer = null;
            const SILENCE_MS = 700; // treat this silence as end-of-utterance

            const processBuffer = async () => {
                if (!sttBuffer || sttBuffer.length === 0) return;
                const mulawBuffer = Buffer.concat(sttBuffer);
                sttBuffer = [];

                // Temporarily stop listening while we process
                isListening = false;

                try {
                    // Convert mulaw to wav buffer
                    const wavBuffer = await mulawBufferToWavBuffer(mulawBuffer);

                    // Try OpenAI Whisper transcription
                    const transcript = await transcribeWithOpenAI(wavBuffer);

                    if (transcript) {
                        // Add to conversation and trigger AI response pipeline
                        await addToConversationHistory(appointmentId, 'user', transcript).catch(() => {});
                        cancelActiveStreams();

                        // Build prompt and stream AI -> TTS -> Twilio
                        try {
                            const appointmentRef = await getAppointmentRef(appointmentId);
                            const appointment = (await appointmentRef.get()).data();
                            // Use existing pipeline: create prompt then stream
                            const contextPrompt = transcript; // passthrough
                            // call streamGeminiToTwilio directly with prompt text
                            streamGeminiToTwilio(contextPrompt).catch(() => {});
                        } catch (err) {
                            // swallow errors - continue conversation
                        }
                    } else {
                        // If transcription not available, save raw audio for offline processing
                        await saveMulawForOffline(mulawBuffer, appointmentId).catch(() => {});
                    }
                } catch (err) {
                    // On any error, save raw buffer for offline processing
                    await saveMulawForOffline(mulawBuffer, appointmentId).catch(() => {});
                } finally {
                    // Re-enable listening after a short delay to avoid immediate re-trigger
                    setTimeout(() => { isListening = true; }, 250);
                }
            };

            const sttStreamShim = {
                write: (chunk) => {
                    try {
                        // Twilio media payloads are base64-encoded μ-law frames
                        const raw = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, 'base64');
                        sttBuffer.push(raw);

                        if (inactivityTimer) clearTimeout(inactivityTimer);
                        inactivityTimer = setTimeout(() => {
                            processBuffer().catch(() => {});
                        }, SILENCE_MS);
                    } catch (e) {
                        // ignore
                    }
                },
                destroy: () => {
                    if (inactivityTimer) clearTimeout(inactivityTimer);
                    sttBuffer = [];
                }
            };

            sttStream = sttStreamShim;
            return sttStream;
    const OPENAI_KEY = process.env.OPENAI_API_KEY;
    if (!OPENAI_KEY) return null;

    // Use node-fetch or global fetch (Node 18+)
    const formData = new (global.FormData || require('form-data'))();
    // Try to append as Blob if available, otherwise as Buffer
    try {
        // For environments with global FormData + Blob
        if (typeof Blob !== 'undefined') {
            const blob = new Blob([wavBuffer], { type: 'audio/wav' });
            formData.append('file', blob, 'audio.wav');
        } else {
            formData.append('file', wavBuffer, { filename: 'audio.wav', contentType: 'audio/wav' });
        }
    } catch (e) {
        // Fallback for "form-data" package
        formData.append('file', wavBuffer, 'audio.wav');
    }

    formData.append('model', 'whisper-1');

    const fetchImpl = global.fetch || require('node-fetch');
    const headers = { 'Authorization': `Bearer ${OPENAI_KEY}` };

    // If using form-data package, let it set headers
    if (formData.getHeaders && typeof formData.getHeaders === 'function') {
        Object.assign(headers, formData.getHeaders());
    }

    const res = await fetchImpl('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers,
        body: formData
    });

    if (!res.ok) {
        return null;
    }

    const json = await res.json();
    return json.text || null;
}

async function saveMulawForOffline(mulawBuffer, appointmentId) {
    try {
        const tmpDir = os.tmpdir();
        const fileName = `stt_${appointmentId || 'unknown'}_${Date.now()}.raw`;
        const filePath = path.join(tmpDir, fileName);
        await fs.promises.writeFile(filePath, mulawBuffer);
        return filePath;
    } catch (err) {
        return null;
    }
}

// Voice ID for ElevenLabs (using Rachel/Sarah voice)
const VOICE_ID = '21m00Tcm4TlvDq8ikWAM';

/**
 * Get appointment reference from Firestore
 */
async function getAppointmentRef(appointmentId) {
    try {
        const snapshot = await db.collectionGroup('appointments').get();
        const foundDoc = snapshot.docs.find(doc => doc.id === appointmentId);

        if (!foundDoc) {
            console.error(`[ERROR] getAppointmentRef: Could not find appointment ${appointmentId}.`);
            throw new Error(`Could not find appointment ${appointmentId}`);
        }
        return foundDoc.ref;
    } catch (error) {
        console.error(`[ERROR] getAppointmentRef: Database error for ${appointmentId}: ${error.message}`);
        throw error;
    }
}

/**
 * Add conversation history entry
 */
async function addToConversationHistory(appointmentId, speaker, message, metadata = {}) {
    try {
        const appointmentRef = await getAppointmentRef(appointmentId);
        const timestamp = new Date().toISOString();
        const historyEntry = {
            speaker,
            message: message.substring(0, 500),
            timestamp,
            ...metadata
        };

        await appointmentRef.update({
            conversationHistory: admin.firestore.FieldValue.arrayUnion(historyEntry),
            lastActivity: timestamp
        });
    } catch (error) {
        console.error(`[ERROR] Failed to add conversation history for ${appointmentId}: ${error.message}`);
        // Don't throw - let the conversation continue
    }
}

/**
 * Convert MP3 audio stream to mulaw format for Twilio
 * @param {AsyncIterable|Stream} inputStream - MP3 audio stream from ElevenLabs
 * @returns {Stream} - mulaw audio stream
 */
/**
 * Convert MP3 audio stream to mulaw format for Twilio
 * @param {Stream} inputStream - MP3 audio stream from ElevenLabs (async iterator)
 * @returns {Stream} - mulaw audio stream
 */
async function transcodeMp3ToMulaw(inputStream) {
    const outputStream = new PassThrough();
    const mp3Stream = new PassThrough();
    
    console.log('[TRANSCODE] Starting MP3 to mulaw conversion...');
    console.log('[TRANSCODE] Input stream type:', inputStream.constructor.name);
    
    // 🛠️ FIX: Convert async iterator to Node.js stream synchronously
    // Start the conversion immediately so FFmpeg gets data as it arrives
    if (inputStream[Symbol.asyncIterator]) {
        console.log('[TRANSCODE] Converting async iterator to Node.js stream...');
        
        // Start reading immediately and write to mp3Stream as data arrives
        (async () => {
            try {
                let chunkCount = 0;
                let bytesReceived = 0;
                
                for await (const chunk of inputStream) {
                    chunkCount++;
                    bytesReceived += chunk.length;
                    
                    if (chunkCount <= 5 || chunkCount % 20 === 0) {
                        console.log(`[TRANSCODE] Input chunk ${chunkCount}: ${chunk.length} bytes (total: ${bytesReceived} bytes)`);
                    }
                    
                    // Write chunk to the stream that FFmpeg is reading from
                    if (!mp3Stream.write(chunk)) {
                        // If the stream's buffer is full, wait for it to drain
                        await new Promise(resolve => mp3Stream.once('drain', resolve));
                    }
                }
                
                console.log(`[TRANSCODE] Input complete. Total: ${chunkCount} chunks, ${bytesReceived} bytes`);
                mp3Stream.end();
            } catch (error) {
                console.error('[ERROR] Failed to read input stream:', error.message);
                mp3Stream.destroy(error);
            }
        })();
    } else if (inputStream.pipe) {
        console.log('[TRANSCODE] Input is already a Node.js stream, piping directly...');
        inputStream.pipe(mp3Stream);
    } else {
        throw new Error('Input stream is neither an async iterator nor a Node.js stream');
    }
    
    let bytesOutput = 0;
    
    const ffmpegProcess = ffmpeg()
        .input(mp3Stream) // ✅ Read from the Node.js stream
        .inputFormat('mp3')
        .audioCodec('pcm_mulaw')
        .audioFrequency(8000)
        .audioChannels(1)
        .format('mulaw')
        .on('error', (err) => {
            console.error('[ERROR] FFmpeg transcoding failed:', err.message);
            outputStream.destroy(err);
        })
        .on('end', () => {
            console.log(`[INFO] Audio transcoding completed. Output: ${bytesOutput} bytes`);
        })
        .on('start', (commandLine) => {
            console.log('[INFO] FFmpeg transcoding started:', commandLine);
        })
        .on('stderr', (stderrLine) => {
            console.log('[FFMPEG]', stderrLine);
        })
        .pipe(outputStream, { end: true });
    
    // Monitor output stream
    outputStream.on('data', (chunk) => {
        bytesOutput += chunk.length;
        
        if (bytesOutput <= 50000 || bytesOutput % 10000 < chunk.length) {
            console.log(`[TRANSCODE] Output chunk: ${chunk.length} bytes (total: ${bytesOutput} bytes)`);
        }
    });
    
    outputStream.on('end', () => {
        console.log(`[TRANSCODE] Output stream ended. Total: ${bytesOutput} bytes`);
    });
        
    return outputStream;
}

// --- Import Context ---
// You will need your ConversationContext and map
// import { conversationContexts, ConversationContext } from './twilioCallService.js'; 


export function setupWebSocketServer(server) {

    // Create a WebSocket server that attaches to your main HTTP server
    // and listens on a specific path.
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws, req) => {
        console.log(`[INFO] WebSocket connection established: ${req.url}`);

        // Get the appointmentId from the URL
        if (!req.url.startsWith('/audio-stream/')) {
            console.warn(`[WARN] Ignoring invalid WebSocket connection at: ${req.url}`);
            ws.close();
            return;
        }
        const urlParts = req.url.split('/');
        const appointmentId = urlParts[urlParts.length - 1];


        console.log(`[INFO] Handling streaming call for appointment: ${appointmentId}`);

        // Store the stream SID from Twilio's start message
        let streamSid = null;

        // Initialize Google Speech-to-Text streaming
        let sttStream = null;
        let isListening = false;

        function initializeSttStream() {
            const request = {
                config: {
                    encoding: 'MULAW',
                    sampleRateHertz: 8000,
                    languageCode: 'en-US',
                    enableAutomaticPunctuation: true,
                },
                interimResults: false,
            };

            sttStream = speechClient
                .streamingRecognize(request)
                .on('error', (error) => {
                    console.error('[ERROR] STT stream error:', error);
                    sttStream = null;
                })
                .on('data', (data) => {
                    if (data.results[0] && data.results[0].isFinal) {
                        const transcript = data.results[0].alternatives[0].transcript;
                        console.log(`[STT] User said: "${transcript}"`);

                        // Log user input to conversation history
                        addToConversationHistory(appointmentId, 'user', transcript).catch(console.error);

                        // Stop listening while AI responds
                        isListening = false;

                        // ✅ FIX: Call the new, fast streaming pipeline directly

                        // 1. Cancel any audio that's already playing (for interruption)
                        cancelActiveStreams();

                        // 2. Create the prompt with appointment context
                        (async () => {
                            try {
                                const appointmentRef = await getAppointmentRef(appointmentId);
                                const appointment = (await appointmentRef.get()).data();

                                const userName = appointment.userName ? appointment.userName.replace(/^(Dr\.?\s*)/i, '').trim() : 'the patient';
                                const reason = appointment.reasonForAppointment || 'medical consultation';
                                const userContact = appointment.userContact || 'No contact number on file';

                                const prompt = `You are Sarah from Aiva Health calling to schedule an appointment. 
                                
                                CONTEXT:
                                - You are calling on behalf of: ${userName}
                                - For: ${reason}
                                - Client's contact: ${userContact}
                                - User just said: "${transcript}"
                                
                                Respond naturally and professionally. Keep it brief (under 50 words).
                                If they suggest a time, confirm it.
                                If they ask for the client's contact info, provide: ${userContact}
                                If they ask questions, answer helpfully.
                                If unclear, ask for clarification.`;

                                // 3. Call the streaming pipeline. 
                                streamGeminiToTwilio(prompt).catch(err => {
                                    console.error("[ERROR] Unhandled streamGeminiToTwilio error:", err);
                                });
                            } catch (error) {
                                console.error('[ERROR] Failed to get appointment context:', error);

                                // Fallback prompt
                                const prompt = `You are Sarah from Aiva Health calling to schedule an appointment. 
                                User just said: "${transcript}"
                                
                                Respond naturally and professionally. Keep it brief (under 50 words).
                                If they suggest a time, confirm it.
                                If they ask questions, answer helpfully.
                                If unclear, ask for clarification.`;

                                streamGeminiToTwilio(prompt).catch(err => {
                                    console.error("[ERROR] Unhandled streamGeminiToTwilio error:", err);
                                });
                            }
                        })();
                    }
                });

            return sttStream;
        }


        /**
         * Stream text from Gemini to ElevenLabs to Twilio in real-time
         * This eliminates the waterfall delay by processing text chunks as they arrive
         */
        async function streamGeminiToTwilio(prompt) {
            try {
                console.log(`[STREAM] Starting real-time Gemini -> ElevenLabs -> Twilio pipeline`);

                let textBuffer = '';
                let sentenceBuffer = '';
                const minChunkSize = 10; // Minimum characters before sending to TTS

                // Start streaming from ChatGPT (gpt-4o-mini)
                const geminiStream = generateChatgptTextStream(prompt);

                for await (const textChunk of geminiStream) {
                    textBuffer += textChunk;
                    sentenceBuffer += textChunk;

                    console.log(`[STREAM] Received text chunk: "${textChunk}"`);

                    // Look for sentence boundaries or sufficient text accumulation
                    const sentenceEnders = /[.!?]\s/g;
                    const sentenceMatch = sentenceBuffer.match(sentenceEnders);

                    // If we have a complete sentence or enough text, stream it
                    if (sentenceMatch || sentenceBuffer.length >= minChunkSize * 3) {
                        let textToStream;

                        if (sentenceMatch) {
                            // Send complete sentences
                            const lastSentenceEnd = sentenceBuffer.lastIndexOf(sentenceMatch[sentenceMatch.length - 1]) + sentenceMatch[sentenceMatch.length - 1].length;
                            textToStream = sentenceBuffer.substring(0, lastSentenceEnd).trim();
                            sentenceBuffer = sentenceBuffer.substring(lastSentenceEnd);
                        } else {
                            // Send chunk if we have enough text
                            textToStream = sentenceBuffer.trim();
                            sentenceBuffer = '';
                        }

                        if (textToStream.length > 0) {
                            console.log(`[STREAM] Streaming to TTS: "${textToStream}"`);

                            // Stream this text chunk to ElevenLabs/Twilio immediately
                            // Don't await - let it stream in parallel with Gemini generation
                            streamAudioToTwilio(textToStream).catch(error => {
                                console.error('[ERROR] Failed to stream audio chunk:', error);
                            });

                            // Small delay to prevent overwhelming the TTS API
                            await new Promise(resolve => setTimeout(resolve, 100));
                        }
                    }
                }

                // Send any remaining text
                if (sentenceBuffer.trim().length > 0) {
                    console.log(`[STREAM] Streaming final chunk: "${sentenceBuffer.trim()}"`);
                    await streamAudioToTwilio(sentenceBuffer.trim());
                }

                console.log(`[STREAM] Complete response streamed: "${textBuffer}"`);

                // Log the complete AI response to conversation history
                addToConversationHistory(appointmentId, 'assistant', textBuffer).catch(console.error);

            } catch (error) {
                console.error('[ERROR] Failed to stream from Gemini to Twilio:', error);

                // Fallback to non-streaming
                const fallbackResponse = "I apologize for the delay. Could you please repeat your question?";
                await streamAudioToTwilio(fallbackResponse);
            }
        }

        let currentStreamId = 0;
        let activeStreams = new Set();

        /**
         * Cancel all active audio streams (for interruption handling)
         */
        function cancelActiveStreams() {
            console.log(`[STREAM] Cancelling ${activeStreams.size} active streams`);
            activeStreams.clear();
        }

        /**
         * This function takes text and streams audio back to Twilio.
         */
        async function streamAudioToTwilio(textStream) {
            const streamId = ++currentStreamId;
            console.log(`[TTS] ========== Starting stream ${streamId} ==========`);
            console.log(`[TTS] Text to synthesize: "${textStream}"`);
            console.log(`[TTS] Text length: ${textStream.length} characters`);

            // Add this stream to active streams
            activeStreams.add(streamId);

            try {
                // 1. Get audio stream from ElevenLabs using our working client
                console.log(`[TTS] Step 1: Calling ElevenLabs API...`);
                const audioStream = await generateSpeechStream(textStream, VOICE_IDS.SARAH);
                console.log(`[TTS] Step 1 complete: ElevenLabs stream received`);
                console.log(`[TTS] Stream type:`, audioStream ? audioStream.constructor.name : 'null');

                // Check if this stream is still valid (not superseded)
                if (!activeStreams.has(streamId)) {
                    console.log(`[TTS] Stream ${streamId} cancelled before audio generation`);
                    return;
                }

                // 2. Transcode MP3 to mulaw (now async)
                console.log(`[TTS] Step 2: Starting transcoding to mulaw...`);
                const mulawStream = await transcodeMp3ToMulaw(audioStream);
                console.log(`[TTS] Step 2 complete: Transcoding stream ready`);

                // 3. Stream the transcoded audio to Twilio
                let chunkCount = 0;
                let sentChunks = 0;
                let totalBytes = 0;
                let skippedSilence = 0;
                let audioBuffer = Buffer.alloc(0); // Buffer to hold audio data
                const CHUNK_SIZE = 160; // Twilio expects 160 bytes (20ms of 8kHz audio)
                const CHUNK_INTERVAL = 20; // Send every 20ms
                
                console.log(`[TTS] Step 3: Starting transmission to Twilio WebSocket...`);
                console.log(`[TTS] WebSocket state: ${ws.readyState} (1=OPEN)`);
                console.log(`[TTS] Will pace audio at ${CHUNK_SIZE} bytes every ${CHUNK_INTERVAL}ms`);

                // Function to send audio at the correct pace
                let pacingInterval = null;
                const startPacing = () => {
                    if (pacingInterval) return; // Already pacing
                    
                    pacingInterval = setInterval(() => {
                        // Check if we should send audio
                        const hasFullChunk = audioBuffer.length >= CHUNK_SIZE;
                        const hasRemainder = audioBuffer.length > 0 && !mulawStream.readable;
                        const shouldSend = (hasFullChunk || hasRemainder) && activeStreams.has(streamId) && ws.readyState === 1;
                        
                        if (shouldSend) {
                            // Send full chunk or remaining bytes
                            const chunkToSend = hasFullChunk ? CHUNK_SIZE : audioBuffer.length;
                            const chunk = audioBuffer.slice(0, chunkToSend);
                            audioBuffer = audioBuffer.slice(chunkToSend);
                            
                            sentChunks++;
                            totalBytes += chunk.length;
                            
                            if (sentChunks <= 10 || sentChunks % 100 === 0 || chunk.length < CHUNK_SIZE) {
                                console.log(`[TTS] Paced chunk ${sentChunks}: ${chunk.length} bytes (buffer: ${audioBuffer.length} bytes remaining)${chunk.length < CHUNK_SIZE ? ' [FINAL]' : ''}`);
                            }
                            
                            // ✅ CRITICAL FIX: Include streamSid in media message
                            ws.send(JSON.stringify({
                                event: 'media',
                                streamSid: streamSid,
                                media: {
                                    payload: chunk.toString('base64'),
                                },
                            }));
                        } else if (audioBuffer.length === 0 && !mulawStream.readable) {
                            // No more audio and stream is done
                            clearInterval(pacingInterval);
                            pacingInterval = null;
                            console.log(`[TTS] Pacing complete - all audio sent`);
                        }
                    }, CHUNK_INTERVAL);
                };

                mulawStream.on('data', (chunk) => {
                    // Only process if this stream is still active
                    if (activeStreams.has(streamId) && ws.readyState === 1) { // 1 = OPEN
                        chunkCount++;

                        // Check if the START of the chunk is silence (0xFF in mulaw)
                        const firstBytes = chunk.slice(0, Math.min(100, chunk.length));
                        const firstBytesSilent = Array.from(firstBytes).filter(byte => byte === 0xFF).length;
                        const firstBytesRatio = firstBytesSilent / firstBytes.length;
                        
                        const allSilentBytes = Array.from(chunk).filter(byte => byte === 0xFF || byte === 0xFE || byte === 0xFD).length;
                        const silentRatio = allSilentBytes / chunk.length;
                        const isMostlySilent = silentRatio > 0.9; // 90% silence
                        
                        // Skip the first chunk ONLY if it starts with >50% 0xFF bytes
                        if (chunkCount === 1 && firstBytesRatio > 0.5) {
                            skippedSilence += chunk.length;
                            console.log(`[TTS] 🔇 SKIPPING first chunk - starts with ${(firstBytesRatio * 100).toFixed(1)}% silence (0xFF)`);
                            console.log(`[TTS] First 40 bytes (hex):`, chunk.slice(0, Math.min(40, chunk.length)).toString('hex'));
                            return;
                        }
                        
                        // Skip additional chunks if they're >90% silent
                        if (chunkCount <= 3 && isMostlySilent) {
                            skippedSilence += chunk.length;
                            console.log(`[TTS] 🔇 SKIPPING silent chunk ${chunkCount}: ${chunk.length} bytes (${(silentRatio * 100).toFixed(1)}% silence)`);
                            console.log(`[TTS] First 20 bytes (hex):`, chunk.slice(0, Math.min(20, chunk.length)).toString('hex'));
                            return;
                        }

                        // Add chunk to buffer for paced sending
                        audioBuffer = Buffer.concat([audioBuffer, chunk]);
                        
                        // Log received chunks
                        if (chunkCount <= 10) {
                            console.log(`[TTS] Received chunk ${chunkCount}: ${chunk.length} bytes (buffer now: ${audioBuffer.length} bytes)${isMostlySilent ? ' [MOSTLY SILENT]' : ' [HAS AUDIO]'}`);
                            if (chunkCount <= 3) {
                                console.log(`[TTS] First 20 bytes (hex):`, chunk.slice(0, Math.min(20, chunk.length)).toString('hex'));
                                console.log(`[TTS] Silent ratio: ${(silentRatio * 100).toFixed(1)}%`);
                            }
                        }
                        
                        // Start pacing if not already started
                        if (!pacingInterval) {
                            console.log(`[TTS] Starting paced transmission...`);
                            startPacing();
                        }
                    } else {
                        if (!activeStreams.has(streamId)) {
                            console.log(`[TTS] Stream ${streamId} no longer active, stopping transmission`);
                        }
                        if (ws.readyState !== 1) {
                            console.log(`[TTS] WebSocket not open (state: ${ws.readyState}), stopping transmission`);
                        }
                    }
                });

                mulawStream.on('end', () => {
                    console.log(`[TTS] Mulaw stream ended. Waiting for buffer to drain...`);
                    console.log(`[TTS] Buffer remaining: ${audioBuffer.length} bytes`);
                    
                    let checkCount = 0;
                    // Wait for pacing to finish sending remaining audio
                    const waitForBuffer = setInterval(() => {
                        checkCount++;
                        
                        // Log buffer status every 10 checks (every 500ms)
                        if (checkCount % 10 === 0) {
                            console.log(`[TTS] Buffer drain check ${checkCount}: ${audioBuffer.length} bytes remaining, activeStreams.has(${streamId})=${activeStreams.has(streamId)}`);
                        }
                        
                        if (audioBuffer.length === 0 || !activeStreams.has(streamId)) {
                            console.log(`[TTS] Buffer drain complete! Final check: buffer=${audioBuffer.length}, activeStream=${activeStreams.has(streamId)}`);
                            clearInterval(waitForBuffer);
                            if (pacingInterval) {
                                clearInterval(pacingInterval);
                                pacingInterval = null;
                            }
                            
                            console.log(`[TTS] ========== Stream ${streamId} COMPLETE ==========`);
                            console.log(`[TTS] Total chunks received: ${chunkCount}`);
                            console.log(`[TTS] Paced chunks sent to Twilio: ${sentChunks}`);
                            console.log(`[TTS] Silent bytes skipped: ${skippedSilence}`);
                            console.log(`[TTS] Audio bytes sent: ${totalBytes}`);
                            
                            // Remove from active streams
                            activeStreams.delete(streamId);

                            // Send a "mark" message to signal end of this audio segment
                            console.log(`[TTS] Sending completion mark: stream-${streamId}-complete`);
                            if (ws.readyState === 1) {
                                ws.send(JSON.stringify({
                                    event: 'mark',
                                    streamSid: streamSid, // Include streamSid
                                    mark: { name: `stream-${streamId}-complete` }
                                }));
                            }
                            
                            // ✅ CRITICAL: Start listening for user response AFTER audio finishes
                            console.log(`[STT] ========================================`);
                            console.log(`[STT] ✅ Audio playback complete!`);
                            console.log(`[STT] Setting isListening = true`);
                            isListening = true;
                            console.log(`[STT] isListening is now: ${isListening}`);
                            
                            // Ensure STT stream is ready
                            if (!sttStream || sttStream.destroyed) {
                                console.log('[STT] ⚠️ STT stream not available. Reinitializing...');
                                initializeSttStream();
                            } else {
                                console.log('[STT] ✅ STT stream is ready to receive audio');
                            }
                            console.log(`[STT] 🎤 NOW LISTENING FOR USER INPUT`);
                            console.log(`[STT] ========================================`);
                            
                            // Send a clear event to Twilio to reset any buffering
                            if (ws.readyState === 1) {
                                ws.send(JSON.stringify({ event: 'clear', streamSid: streamSid }));
                                console.log(`[TTS] Sent clear event to Twilio`);
                            }
                        }
                    }, 50); // Check every 50ms for faster response
                });

                mulawStream.on('error', (error) => {
                    console.error(`[TTS] ========== Stream ${streamId} ERROR ==========`);
                    console.error(`[TTS] Error:`, error);
                    console.error(`[TTS] Error stack:`, error.stack);
                    console.error(`[TTS] Chunks received before error: ${chunkCount}`);
                    console.error(`[TTS] Paced chunks sent before error: ${sentChunks}`);
                    console.error(`[TTS] Bytes sent before error: ${totalBytes}`);

                    // Stop pacing
                    if (pacingInterval) {
                        clearInterval(pacingInterval);
                        pacingInterval = null;
                    }

                    // Remove from active streams
                    activeStreams.delete(streamId);

                    // Send mark anyway to continue conversation
                    if (ws.readyState === 1) {
                        ws.send(JSON.stringify({
                            event: 'mark',
                            mark: { name: `stream-${streamId}-error` }
                        }));
                    }
                });

            } catch (error) {
                console.error(`[TTS] ========== Stream ${streamId} EXCEPTION ==========`);
                console.error(`[TTS] Exception:`, error);
                console.error(`[TTS] Exception stack:`, error.stack);

                // Remove from active streams
                activeStreams.delete(streamId);

                // Fallback: Send a mark to continue conversation
                if (ws.readyState === 1) {
                    ws.send(JSON.stringify({
                        event: 'mark',
                        mark: { name: `stream-${streamId}-failed` }
                    }));
                }
            }
        }

        // --- Handle incoming messages from Twilio ---
        ws.on('message', (message) => {
            const msg = JSON.parse(message);

            switch (msg.event) {
                case 'start':
                    // ✅ CRITICAL: Capture the streamSid from Twilio
                    streamSid = msg.start.streamSid;
                    console.log(`[INFO] Twilio stream started for ${appointmentId}`);
                    console.log(`[INFO] Stream SID: ${streamSid}`);

                    // Update appointment status to indicate streaming has started
                    (async () => {
                        try {
                            const appointmentRef = await getAppointmentRef(appointmentId);
                            await appointmentRef.update({
                                callInProgress: true,
                                streamStartedAt: new Date().toISOString(),
                                lastActivity: new Date().toISOString()
                            });
                            console.log(`[INFO] Updated appointment ${appointmentId} - streaming started`);
                        } catch (error) {
                            console.error(`[ERROR] Failed to update appointment status for ${appointmentId}:`, error);
                        }
                    })();

                    // Initialize STT stream
                    initializeSttStream();

                    // Get appointment details for personalized greeting
                    (async () => {
                        try {
                            const appointmentRef = await getAppointmentRef(appointmentId);
                            const appointment = (await appointmentRef.get()).data();

                            const userName = appointment.userName ? appointment.userName.replace(/^(Dr\.?\s*)/i, '').trim() : 'the patient';
                            const reason = appointment.reasonForAppointment || 'medical consultation';

                            // Send personalized initial greeting
                            const greeting = `Hi! This is Sarah from Aiva Health. I'm calling on behalf of ${userName} to schedule an appointment for ${reason}. What time works best for you?`;

                            // Log the greeting
                            addToConversationHistory(appointmentId, 'assistant', greeting).catch(console.error);

                            // Call our streaming TTS function
                            streamAudioToTwilio(greeting);
                        } catch (error) {
                            console.error('[ERROR] Failed to get appointment details:', error);

                            // Fallback greeting
                            const greeting = `Hi! This is Sarah from Aiva Health. I'm calling to schedule an appointment. What time works best for you?`;
                            addToConversationHistory(appointmentId, 'assistant', greeting).catch(console.error);
                            streamAudioToTwilio(greeting);
                        }
                    })();
                    break;

                case 'media':
                    // Forward incoming audio to Google Speech-to-Text, but only if we're actively listening
                    if (isListening && sttStream) {
                        const audioChunk = Buffer.from(msg.media.payload, 'base64');
                        try {
                            // Log first few audio packets
                            if (Math.random() < 0.05) { // 5% sampling to see it's working
                                console.log(`[STT] 🎤 Processing audio: ${audioChunk.length} bytes (isListening=${isListening})`);
                            }
                            sttStream.write(audioChunk);
                        } catch (error) {
                            console.error('[ERROR] Failed to write to STT stream:', error);
                            // Reinitialize STT stream if it fails
                            sttStream = initializeSttStream();
                        }
                    } else {
                        // Log why we're not processing audio
                        if (!isListening) {
                            // Only log occasionally to avoid spam
                            if (Math.random() < 0.01) { // 1% chance
                                console.log('[STT] Not listening yet - waiting for AI to finish speaking');
                            }
                        } else if (!sttStream) {
                            console.log('[STT] WARNING: isListening=true but sttStream is null!');
                        }
                    }
                    break;

                case 'stop':
                    console.log(`[INFO] Twilio stream stopped for ${appointmentId}.`);

                    // Update appointment status to indicate streaming has ended
                    (async () => {
                        try {
                            const appointmentRef = await getAppointmentRef(appointmentId);
                            await appointmentRef.update({
                                callInProgress: false,
                                streamEndedAt: new Date().toISOString(),
                                lastActivity: new Date().toISOString()
                            });
                            console.log(`[INFO] Updated appointment ${appointmentId} - streaming ended`);
                        } catch (error) {
                            console.error(`[ERROR] Failed to update appointment status on stop for ${appointmentId}:`, error);
                        }
                    })();

                    // Clean up STT stream
                    if (sttStream) {
                        sttStream.destroy();
                        sttStream = null;
                    }
                    isListening = false;
                    break;

                case 'mark':
                    // This confirms our "ai-finished-speaking" mark was received.
                    // This is your signal to start listening to the user again.
                    console.log(`[INFO] ✅ Received mark from Twilio: ${msg.mark?.name || 'unknown'}`);
                    console.log(`[STT] Setting isListening = true`);
                    isListening = true;

                    // Reinitialize STT stream for next user input
                    if (!sttStream) {
                        console.log(`[STT] Reinitializing STT stream for next user input...`);
                        initializeSttStream();
                    } else {
                        console.log(`[STT] STT stream already exists, ready to receive audio`);
                    }
                    break;
            }
        });

        ws.on('close', (code, reason) => {
            console.log(`[INFO] WebSocket closed for ${appointmentId}: ${code} ${reason.toString()}`);

            // Update appointment status when WebSocket closes
            (async () => {
                try {
                    const appointmentRef = await getAppointmentRef(appointmentId);
                    await appointmentRef.update({
                        callInProgress: false,
                        streamEndedAt: new Date().toISOString(),
                        lastActivity: new Date().toISOString()
                    });
                    console.log(`[INFO] Updated appointment ${appointmentId} - WebSocket closed`);
                } catch (error) {
                    console.error(`[ERROR] Failed to update appointment on WebSocket close for ${appointmentId}:`, error);
                }
            })();

            // Clean up STT stream
            if (sttStream) {
                sttStream.destroy();
                sttStream = null;
            }
            isListening = false;
        });

        ws.on('error', (error) => {
            console.error(`[ERROR] WebSocket error for ${appointmentId}:`, error);

            // Update appointment status on WebSocket error
            (async () => {
                try {
                    const appointmentRef = await getAppointmentRef(appointmentId);
                    await appointmentRef.update({
                        callInProgress: false,
                        streamError: error.message,
                        lastActivity: new Date().toISOString()
                    });
                    console.log(`[INFO] Updated appointment ${appointmentId} - WebSocket error`);
                } catch (updateError) {
                    console.error(`[ERROR] Failed to update appointment on WebSocket error for ${appointmentId}:`, updateError);
                }
            })();

            // Clean up STT stream
            if (sttStream) {
                sttStream.destroy();
                sttStream = null;
            }
            isListening = false;
        });
    });
}