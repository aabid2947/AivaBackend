// src/routes/appointmentRoutes.js
import express from 'express';
import { appointmentController } from '../controllers/appointmentController.js';
import { authMiddleware } from '../middleware/authMiddleware.js';

const router = express.Router();

router.use(authMiddleware); // Apply authMiddleware to all appointment routes

router.post('/', appointmentController.scheduleAppointment); // POST to /api/appointments to book
router.get('/', appointmentController.listAppointments);     // GET /api/appointments to list

export default router;