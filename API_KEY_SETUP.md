# 🔑 ElevenLabs API Key Setup Guide

## The Issue
You're getting a **401 Authentication Error** which means the provided API key is invalid or expired.

## 🛠️ Solution: Get a New API Key

### Step 1: Create ElevenLabs Account
1. Go to [ElevenLabs.io](https://elevenlabs.io/)
2. Click **"Sign Up"** (or **"Log In"** if you have an account)
3. Complete the registration process

### Step 2: Get Your API Key
1. Once logged in, click on your **profile picture** (top right)
2. Select **"Profile Settings"**
3. Navigate to **"API Keys"** tab
4. Click **"Create API Key"**
5. Give it a name like "Aiva Backend"
6. **Copy the API key** (starts with `sk_`)

### Step 3: Update Your Environment
Add the new API key to your `.env` file:

```env
ELEVENLABS_API_KEY=sk_your_new_api_key_here
```

**⚠️ Important:**
- Replace `sk_your_new_api_key_here` with your actual API key
- Make sure there are no spaces around the `=` sign
- Save the file

### Step 4: Restart Your Server
```powershell
# Stop the current server (Ctrl+C if running)
# Then restart:
npm start
```

## ✅ Verify It's Working

You should see these logs on startup:

```
[INFO] Testing ElevenLabs API connection...
[INFO] ElevenLabs client initialized successfully.
[INFO] Account: Free
[INFO] Character quota: 0/10000
```

## 🆓 Free Tier Information

ElevenLabs Free Tier includes:
- **10,000 characters per month**
- Access to all standard voices
- Commercial usage allowed

This should be enough for testing and moderate usage.

## 🔍 Alternative: Test Without ElevenLabs

If you want to test the system without ElevenLabs first:

1. **Don't set** `ELEVENLABS_API_KEY` in your `.env`
2. The system will automatically use **Twilio's Polly voice** as fallback
3. You'll see this log: `[INFO] System will fall back to Twilio TTS for voice generation.`

## 🚨 Common Issues

### Issue: "Invalid API key format"
**Cause:** API key doesn't start with `sk_`
**Solution:** Double-check you copied the complete key from ElevenLabs

### Issue: Still getting 401 after new key
**Cause:** Key might not be activated yet
**Solution:** 
1. Wait 5 minutes and try again
2. Check if email verification is required
3. Try generating a new key

### Issue: Can't find API Keys section
**Solution:**
1. Make sure you're logged into ElevenLabs
2. Look for gear/settings icon
3. Try this direct link: [ElevenLabs API Keys](https://elevenlabs.io/app/settings/api-keys)

## 🧪 Test Your Setup

Once configured, test with this simple command:

```powershell
npm start
```

Look for the initialization logs. If successful, your appointment booking system will now use high-quality ElevenLabs voices!

## 📞 Next Steps

1. ✅ Get valid API key
2. ✅ Update `.env` file  
3. ✅ Restart server
4. ✅ Verify logs show success
5. 🚀 Test with actual appointment call

---

**Need help?** Check the ElevenLabs documentation: https://elevenlabs.io/docs