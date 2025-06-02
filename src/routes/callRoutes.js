// src/routes/callRoutes.js
import express from 'express';
import { callController } from '../controllers/callController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware); // Apply authMiddleware to all call routes

router.post('/', callController.manageCallData);  // For logging calls or setting preferences
router.get('/', callController.retrieveCallData); // For retrieving logs or settings

export default router;