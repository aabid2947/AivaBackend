// src/controllers/appointmentController.js
import { appointmentService } from '../services/appointmentService.js';
import { errorHandler } from '../utils/errorHandler.js';

export const appointmentController = {
  async scheduleAppointment(req, res) {
    try {
      const userId = req.user.uid;
      const appointmentDetails = req.body;
      const result = await appointmentService.bookAppointment(userId, appointmentDetails);
      res.status(201).json(result); // 201 for created resource
    } catch (error) {
      errorHandler(res, error, 'Failed to book appointment.');
    }
  },

  async listAppointments(req, res) {
    try {
      const userId = req.user.uid;
      const appointments = await appointmentService.getUpcomingAppointments(userId);
      res.status(200).json(appointments);
    } catch (error) {
      errorHandler(res, error, 'Failed to retrieve appointments.');
    }
  }
};