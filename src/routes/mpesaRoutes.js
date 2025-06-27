import { Router } from 'express';
import { initiateStkPush, handleCallback } from '../controllers/mpesaController.js';

const router = Router();

// @route   POST /api/payments/mpesa/stk-push
// @desc    Initiate an M-Pesa STK push payment
// @access  Public (or protected, depending on your app's auth)
router.post('/stk-push', initiateStkPush);

// @route   POST /api/payments/mpesa/callback
// @desc    M-Pesa callback URL for STK push
// @access  Public
router.post('/callback', handleCallback);

export default router;
