// src/controllers/emailController.js
import { emailService } from '../services/emailService.js';
import { errorHandler } from '../utils/errorHandler.js';

export const emailController = {
  async updateEmailPreferences(req, res) {
    try {
      const userId = req.user.uid; // Assuming authMiddleware populates req.user
      const preferences = req.body;
      const result = await emailService.setMonitoringPreferences(userId, preferences);
      res.status(200).json(result);
    } catch (error) {
      errorHandler(res, error, 'Failed to update email monitoring preferences.');
    }
  },

  async fetchEmailSummary(req, res) {
    try {
      const userId = req.user.uid;
      const result = await emailService.getEmailSummary(userId);
      res.status(200).json(result);
    } catch (error) {
      errorHandler(res, error, 'Failed to fetch email summary.');
    }
  }
};