# ElevenLabs Integration Setup Guide

## Overview
This project now uses ElevenLabs AI for high-quality text-to-speech during Twilio phone calls, providing more natural and human-like voice interactions for appointment booking.

## What Changed

### Previous Architecture
- **Twilio Gather** → Records user speech
- **Twilio Speech Recognition** → Converts to text
- **Gemini AI** → Generates response text
- **Twilio Say** → Converts text to speech (robotic voice)

### New Architecture
- **Twilio Gather** → Records user speech (unchanged)
- **Twilio Speech Recognition** → Converts to text (unchanged)
- **Gemini AI** → Generates response text (unchanged)
- **ElevenLabs TTS** → Converts text to high-quality speech
- **Twilio Play** → Plays ElevenLabs audio

## Setup Instructions

### 1. Get Your ElevenLabs API Key

Your API key has already been provided:
```
sk_d51a9dd118c578a31a2f13f38ab85208a381b1ff6ac2bd5b
```

Alternatively, you can get a new one:
1. Go to [ElevenLabs](https://elevenlabs.io/)
2. Sign up or log in
3. Navigate to **Profile Settings** → **API Keys**
4. Generate a new API key

### 2. Add Environment Variables

Create or update your `.env` file in the project root:

```env
# Existing variables
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
GEMINI_API_KEY=your_gemini_api_key
API_BASE_URL=https://your-api-domain.com

# NEW: ElevenLabs Configuration
ELEVENLABS_API_KEY=sk_d51a9dd118c578a31a2f13f38ab85208a381b1ff6ac2bd5b
ELEVENLABS_AGENT_ID=your_agent_id_optional
```

### 3. Install Dependencies

The implementation uses `axios` and `ws` packages. Install them:

```powershell
npm install axios ws
```

Or if you prefer to install all dependencies:

```powershell
npm install
```

### 4. Verify ElevenLabs Account

Check your ElevenLabs account tier and quota:
- **Free Tier**: 10,000 characters/month
- **Paid Tiers**: Higher limits and better voices

### 5. Test the Integration

Start your server:
```powershell
npm start
```

The server will automatically:
1. Initialize the ElevenLabs client
2. Log connection status
3. Display your account tier

Look for these logs:
```
[INFO] ElevenLabs client initialized successfully.
[INFO] Account: Free (or your tier)
```

## How It Works

### Voice Generation Flow

1. **Greeting Generation**
   ```javascript
   // Generate greeting with Gemini
   const greeting = await generateGeminiText(greetingPrompt);
   
   // Convert to speech with ElevenLabs
   const audioUrl = await generateAndCacheSpeech(greeting, appointmentId);
   
   // Play in Twilio call
   if (audioUrl) {
       gather.play(audioUrl);
   } else {
       gather.say({ voice: 'Polly.Joanna' }, greeting); // Fallback
   }
   ```

2. **Conversation Continues**
   - User speaks → Twilio transcribes
   - Gemini generates intelligent response
   - ElevenLabs converts to natural voice
   - Twilio plays audio to user

### Voice Selection

The system uses ElevenLabs' "Rachel" voice by default for a warm, professional female voice. You can customize this:

```javascript
// In elevenLabsClient.js
const VOICE_IDS = {
    SARAH: '21m00Tcm4TlvDq8ikWAM',      // Rachel - warm female
    PROFESSIONAL: 'EXAVITQu4vr4xnSDxMaL', // Bella - professional
    FRIENDLY: 'pNInz6obpgDQGcFmaJgB',     // Adam - friendly neutral
};
```

To use a different voice, update the call in `twilioCallService.js`:
```javascript
const audioBuffer = await generateSpeech(text, VOICE_IDS.PROFESSIONAL);
```

## Production Considerations

### 1. Audio Storage
Currently, audio buffers are stored in memory. For production:

**Option A: Use Cloud Storage (Recommended)**
```javascript
async function generateAndCacheSpeech(text, appointmentId) {
    const audioBuffer = await generateSpeech(text, VOICE_IDS.SARAH);
    
    // Upload to S3/Google Cloud Storage
    const audioUrl = await uploadToCloudStorage(audioBuffer, appointmentId);
    
    return audioUrl; // Twilio can play this directly
}
```

**Option B: Stream Directly**
```javascript
// Use ElevenLabs streaming endpoint
const stream = await generateSpeechStream(text);
// Pipe to Twilio
```

### 2. Caching Strategy
Implement caching for common phrases:

```javascript
const commonPhrases = {
    'greeting': 'Hi, this is Sarah from Aiva Health...',
    'confirmation': 'Great! Let me confirm that...',
    'goodbye': 'Thank you for your time...'
};

// Pre-generate and cache on startup
await preGenerateCommonPhrases();
```

### 3. Error Handling
The system automatically falls back to Twilio's Polly voice if ElevenLabs fails:

```javascript
if (audioUrl) {
    gather.play(audioUrl);
} else {
    gather.say({ voice: 'Polly.Joanna' }, text); // Fallback
}
```

### 4. Cost Optimization

**ElevenLabs Pricing** (as of 2024):
- Free: 10,000 characters/month
- Starter: $5/month → 30,000 characters
- Creator: $22/month → 100,000 characters
- Pro: $99/month → 500,000 characters

**Optimization Tips:**
1. Cache common phrases
2. Use shorter, concise responses
3. Implement character counting
4. Monitor usage via ElevenLabs dashboard

## Advanced Features

### 1. Conversational AI (Future Enhancement)

ElevenLabs offers a Conversational AI API for full real-time conversations:

```javascript
// Create agent session
const session = await createConversationalSession(agentId, {
    userName: appointment.userName,
    reason: appointment.reason
});

// Connect via WebSocket
const ws = connectConversationalWebSocket(session.signedUrl);
```

This would eliminate the need for:
- Separate Gemini calls
- Managing conversation state
- Manual speech generation

### 2. Voice Cloning

For personalized experiences, clone a specific voice:
1. Upload voice samples to ElevenLabs
2. Train custom voice model
3. Use custom voice ID in calls

### 3. Multilingual Support

ElevenLabs supports 29+ languages:
```javascript
const audioBuffer = await generateSpeech(text, VOICE_IDS.SARAH, {
    language: 'es' // Spanish
});
```

## Troubleshooting

### Issue: "ELEVENLABS_API_KEY not configured"
**Solution**: Add the API key to your `.env` file and restart the server.

### Issue: "Failed to generate ElevenLabs speech"
**Possible Causes:**
1. Invalid API key
2. Quota exceeded
3. Network issues

**Solution**: Check logs for specific error, verify API key, check ElevenLabs dashboard.

### Issue: Audio sounds robotic (Polly voice)
**Cause**: ElevenLabs fallback didn't work, using Twilio TTS.

**Solution**: 
1. Check ElevenLabs API key is valid
2. Verify network connectivity
3. Check server logs for errors

### Issue: High latency in calls
**Possible Causes:**
1. ElevenLabs API response time
2. Network latency
3. Large audio files

**Solution**:
1. Use `eleven_turbo_v2` model (faster)
2. Implement audio streaming
3. Cache common responses
4. Use CDN for audio files

## Monitoring

### Check ElevenLabs Usage
```javascript
// In elevenLabsClient.js
const response = await axios.get(`${ELEVENLABS_API_BASE}/user`, {
    headers: { 'xi-api-key': ELEVENLABS_API_KEY }
});
console.log('Quota:', response.data.subscription);
```

### Add Usage Tracking
```javascript
let totalCharactersUsed = 0;

async function generateSpeech(text, voiceId) {
    totalCharactersUsed += text.length;
    console.log(`[INFO] Total characters used: ${totalCharactersUsed}`);
    // ... rest of function
}
```

## Migration from Old System

No migration needed! The system is backward compatible:
- If ElevenLabs is configured → Uses ElevenLabs
- If ElevenLabs fails → Falls back to Twilio Polly
- If API key missing → Uses Twilio Polly

## Next Steps

1. **Test with Real Calls**: Make test appointment calls
2. **Monitor Quality**: Listen to call recordings
3. **Optimize Costs**: Implement caching strategy
4. **Consider Upgrade**: Evaluate if Conversational AI fits your use case

## Support

- **ElevenLabs Docs**: https://elevenlabs.io/docs
- **ElevenLabs Discord**: Join for community support
- **Twilio Docs**: https://www.twilio.com/docs

## File Structure

```
AivaBackend/
├── src/
│   ├── services/
│   │   └── twilioCallService.js    # Updated with ElevenLabs
│   └── utils/
│       ├── geminiClient.js         # Existing (unchanged)
│       └── elevenLabsClient.js     # NEW - ElevenLabs integration
├── package.json                     # Updated with axios and ws
├── .env                            # Add ELEVENLABS_API_KEY here
└── ELEVENLABS_SETUP.md             # This file
```

## License
This integration maintains the same license as the main project.
