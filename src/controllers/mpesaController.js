import { stkPushPayment } from '../services/mpesaService.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Controller to initiate an STK push payment.
 */
export const initiateStkPush = async (req, res) => {
  try {
    const { amount, phoneNumber, accountRef, transactionDesc } = req.body;

    // Basic validation
    if (!amount || !phoneNumber) {
      return res.status(400).json({
        message: 'Amount and phone number are required.'
      });
    }

    // You might want to add more validation here (e.g., for phone number format)

    const response = await stkPushPayment({
      amount,
      phoneNumber,
      accountRef: accountRef || 'AivaAppPayment',
      transactionDesc: transactionDesc || 'Payment for services',
    });

    res.status(200).json(response);
  } catch (error) {
    console.error('STK Push Controller Error:', error.message);
    res.status(500).json({ message: 'An internal server error occurred.' });
  }
};

/**
 * Controller to handle the M-Pesa callback.
 */
export const handleCallback = async (req, res) => {
  console.log('--- M-Pesa Callback Received ---');
  const callbackData = req.body;
  console.log(JSON.stringify(callbackData, null, 2));

  // Log the callback data to a file for persistence
  try {
    const logFilePath = path.join(process.cwd(), 'mpesa-callbacks.log');
    await fs.appendFile(logFilePath, `${new Date().toISOString()}: ${JSON.stringify(callbackData)}\n`);
  } catch (logError) {
    console.error('Error writing to callback log file:', logError.message);
  }

  const stkCallback = callbackData.Body?.stkCallback;

  if (!stkCallback) {
    console.log('Callback is not a valid STK push callback.');
    // Acknowledge receipt even if not the expected format
    return res.status(200).json({
      ResultCode: 0,
      ResultDesc: 'Accepted'
    });
  }

  const resultCode = stkCallback.ResultCode;

  if (resultCode === 0) {
    // Payment was successful
    console.log('Payment Successful. Details:', stkCallback.CallbackMetadata.Item);
    // TODO: Add your business logic here
    // 1. Find the transaction in your database using `stkCallback.CheckoutRequestID`.
    // 2. Verify the amount and other details.
    // 3. Update the transaction status to "Completed".
    // 4. Grant access to the service/product the user paid for.
  } else {
    // Payment failed or was cancelled
    console.log('Payment Failed/Cancelled. ResultCode:', resultCode, 'ResultDesc:', stkCallback.ResultDesc);
    // TODO: Add your business logic here
    // 1. Find the transaction in your database.
    // 2. Update its status to "Failed" or "Cancelled".
  }

  // Respond to Safaricom to acknowledge receipt of the callback
  res.status(200).json({
    ResultCode: 0,
    ResultDesc: 'Accepted'
  });
};
