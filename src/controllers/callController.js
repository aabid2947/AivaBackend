// src/controllers/callController.js
import { callService } from '../services/callService.js';
import { errorHandler } from '../utils/errorHandler.js';

export const callController = {
  async manageCallData(req, res) {
    try {
      const userId = req.user.uid;
      const callData = req.body;
      // This could be a POST to log a call or PUT to update settings
      const result = await callService.logOrConfigureCall(userId, callData);
      res.status(200).json(result);
    } catch (error) {
      errorHandler(res, error, 'Failed to manage call data.');
    }
  },

  async retrieveCallData(req, res) {
    try {
      const userId = req.user.uid;
      const callInfo = await callService.getCallInfo(userId);
      res.status(200).json(callInfo);
    } catch (error) {
      errorHandler(res, error, 'Failed to retrieve call data.');
    }
  }
};