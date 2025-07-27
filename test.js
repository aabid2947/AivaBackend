const twilioSid   = process.env.TWILIO_ACCOUNT_SID;
const twilioToken = process.env.TWILIO_AUTH_TOKEN;
const client      = require('twilio')(twilioSid, twilioToken);

async function listMyNumbers() {
  try {
    const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });
    console.log('Active phone numbers on this account:');
    numbers.forEach(n => console.log(` • ${n.phoneNumber}  (SID: ${n.sid})`));
  } catch (err) {
    console.error('Failed to fetch numbers:', err);
  }
}

listMyNumbers();