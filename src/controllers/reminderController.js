// // src/controllers/reminderController.js
// import { reminderService } from '../services/reminderService.js';
// import { errorHandler } from '../utils/errorHandler.js'; //

// export const reminderController = {
//   async addReminder(req, res) {
//     try {
//       const userId = req.user.uid; // Assuming authMiddleware adds user object with uid
//       const { objective, reminderDateTime } = req.body;

//       if (!objective || !reminderDateTime) {
//         return res.status(400).json({ message: 'Objective and reminderDateTime are required.' });
//       }

//       const reminder = await reminderService.createReminder(userId, { objective, reminderDateTime });
//       res.status(201).json({ message: 'Reminder created successfully.', reminder });
//     } catch (error) {
//       errorHandler(res, error, 'Failed to create reminder.'); //
//     }
//   },

//   async getUserReminders(req, res) {
//     try {
//       const userId = req.user.uid; //
//       const { status } = req.query; // Optional query parameter for filtering by status

//       const reminders = await reminderService.getReminders(userId, status);
//       res.status(200).json(reminders);
//     } catch (error) {
//       errorHandler(res, error, 'Failed to retrieve reminders.'); //
//     }
//   },

//   async modifyReminder(req, res) {
//     try {
//       const userId = req.user.uid; //
//       const { reminderId } = req.params;
//       const updateData = req.body;

//       if (!reminderId) {
//         return res.status(400).json({ message: 'Reminder ID is required.' });
//       }
//       if (Object.keys(updateData).length === 0) {
//         return res.status(400).json({ message: 'No update data provided.' });
//       }

//       const updatedReminder = await reminderService.updateReminder(userId, reminderId, updateData);
//       res.status(200).json({ message: 'Reminder updated successfully.', reminder: updatedReminder });
//     } catch (error) {
//       if (error.message.includes('Reminder not found')) {
//         errorHandler(res, error, error.message, 404); //
//       } else {
//         errorHandler(res, error, 'Failed to update reminder.'); //
//       }
//     }
//   },

//   async removeReminder(req, res) {
//     try {
//       const userId = req.user.uid; //
//       const { reminderId } = req.params;

//       if (!reminderId) {
//         return res.status(400).json({ message: 'Reminder ID is required.' });
//       }

//       await reminderService.deleteReminder(userId, reminderId);
//       res.status(200).json({ message: 'Reminder deleted successfully.' });
//     } catch (error) {
//       if (error.message.includes('Reminder not found')) {
//         errorHandler(res, error, error.message, 404); //
//       } else {
//         errorHandler(res, error, 'Failed to delete reminder.'); //
//       }
//     }
//   },
// };