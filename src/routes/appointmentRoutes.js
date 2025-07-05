// src/routes/appointmentRoutes.js
import express from 'express';
import {
    getUserAppointments,
    getAppointmentDetails
} from '../controllers/appointmentController.js';
// Corrected import from authMiddleware
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

// Middleware to protect routes - using the correct function name
router.use(authMiddleware);

// GET all appointments for the authenticated user
// The userId will be available from the authMiddleware via req.user.uid
router.get('/', getUserAppointments);

// GET details for a specific appointment
router.get('/:appointmentId', getAppointmentDetails);

export default router;
