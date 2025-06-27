import axios from 'axios';
import 'dotenv/config';

// In-memory cache for the M-Pesa token
let mpesaToken = {
  value: null,
  expires: 0,
};

/**
 * Generates or retrieves a cached M-Pesa OAuth token.
 * @returns {Promise<string>} The M-Pesa access token.
 */
export const getMpesaToken = async () => {
  // Check if the token is still valid
  if (mpesaToken.value && Date.now() < mpesaToken.expires) {
    return mpesaToken.value;
  }

  // If token is invalid or expired, fetch a new one
  try {
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;

    if (!consumerKey || !consumerSecret) {
      throw new Error('M-Pesa consumer key or secret is not defined in .env');
    }

    const auth = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');

    const response = await axios.get(
      `${process.env.MPESA_API_URL}/oauth/v1/generate?grant_type=client_credentials`, {
        headers: {
          Authorization: `Basic ${auth}`,
        },
      }
    );

    const token = response.data.access_token;
    const expiresIn = response.data.expires_in; // Typically 3599 seconds

    // Cache the new token and set its expiry time (with a 60-second buffer)
    mpesaToken = {
      value: token,
      expires: Date.now() + (expiresIn - 60) * 1000,
    };

    console.log('Successfully fetched new M-Pesa token.');
    return token;
  } catch (error) {
    console.error('Error fetching M-Pesa token:', error.response ? error.response.data : error.message);
    throw new Error('Could not fetch M-Pesa token.');
  }
};

/**
 * Initiates an STK push payment request.
 * @param {object} paymentDetails - The payment details.
 * @param {number} paymentDetails.amount - The amount to be paid.
 * @param {string} paymentDetails.phoneNumber - The user's phone number (e.g., 2547XXXXXXXX).
 * @param {string} paymentDetails.accountRef - The account reference.
 * @param {string} paymentDetails.transactionDesc - A description of the transaction.
 * @returns {Promise<object>} The response from the M-Pesa API.
 */
export const stkPushPayment = async ({
  amount,
  phoneNumber,
  accountRef,
  transactionDesc
}) => {
  try {
    const token = await getMpesaToken();
    const shortCode = process.env.MPESA_BUSINESS_SHORTCODE;
    const passkey = process.env.MPESA_PASSKEY;

    const timestamp = new Date()
      .toISOString()
      .replace(/[^0-9]/g, '')
      .slice(0, -3); // YYYYMMDDHHMMSS

    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: shortCode,
      Password: password,
      Timestamp: timestamp,
      TransactionType: process.env.MPESA_TRANSACTION_TYPE,
      Amount: amount,
      PartyA: phoneNumber,
      PartyB: shortCode,
      PhoneNumber: phoneNumber,
      CallBackURL: process.env.MPESA_CALLBACK_URL,
      AccountReference: accountRef,
      TransactionDesc: transactionDesc,
    };

    const response = await axios.post(
      `${process.env.MPESA_API_URL}/mpesa/stkpush/v1/processrequest`,
      payload, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    console.log('STK push initiated successfully.');
    return response.data;
  } catch (error) {
    console.error('Error initiating STK push:', error.response ? error.response.data : error.message);
    throw new Error('Failed to initiate M-Pesa payment.');
  }
};
