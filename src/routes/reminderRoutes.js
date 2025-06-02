// src/routes/reminderRoutes.js
import express from 'express';
import { reminderController } from '../controllers/reminderController.js';
import { authMiddleware } from '../middleware/authMiddleware.js'; //

const router = express.Router(); //

// All reminder routes are protected and require authentication
router.use(authMiddleware); // Apply authMiddleware to all routes in this file

router.post('/', reminderController.addReminder);
router.get('/', reminderController.getUserReminders);
router.put('/:reminderId', reminderController.modifyReminder);
router.delete('/:reminderId', reminderController.removeReminder);

export default router;