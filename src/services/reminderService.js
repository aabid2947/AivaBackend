// // src/services/reminderService.js
// import { getFirestore, admin } from '../config/firebaseAdmin.js'; //

// const REMINDERS_COLLECTION = 'reminders';
// const USERS_COLLECTION = 'users'; // Assuming your users are in a 'users' collection

// export const reminderService = {
//   /**
//    * Creates a new payment reminder for a user.
//    * @param {string} userId - The ID of the user creating the reminder.
//    * @param {object} reminderData - Data for the reminder (e.g., { objective, reminderDateTime }).
//    * @returns {Promise<object>} The created reminder object with its ID.
//    * @throws {Error} If Firestore operation fails.
//    */
//   async createReminder(userId, reminderData) {
//     try {
//       const db = getFirestore(); //
//       const { objective, reminderDateTime } = reminderData;

//       if (!objective || !reminderDateTime) {
//         throw new Error('Objective and reminderDateTime are required for a reminder.');
//       }

//       const newReminderRef = db.collection(USERS_COLLECTION).doc(userId)
//                                .collection(REMINDERS_COLLECTION).doc();

//       const reminder = {
//         id: newReminderRef.id,
//         userId, // Store userId for potential denormalization or broader queries if needed later
//         objective,
//         reminderDateTime: new Date(reminderDateTime), // Ensure it's a Date object for Firestore
//         status: 'pending', // Default status
//         createdAt: admin.firestore.FieldValue.serverTimestamp(), //
//         updatedAt: admin.firestore.FieldValue.serverTimestamp(),
//       };

//       await newReminderRef.set(reminder);
//       console.log(`ReminderService: Reminder created for UID: ${userId}, ReminderID: ${newReminderRef.id}`);
//       return reminder;
//     } catch (error) {
//       console.error('ReminderService: Error creating reminder:', error);
//       throw error;
//     }
//   },

//   /**
//    * Retrieves all payment reminders for a specific user.
//    * @param {string} userId - The ID of the user.
//    * @param {string} [status] - Optional status to filter reminders by (e.g., 'pending', 'completed').
//    * @returns {Promise<Array<object>>} An array of reminder objects.
//    * @throws {Error} If Firestore operation fails.
//    */
//   async getReminders(userId, status) {
//     try {
//       const db = getFirestore(); //
//       let query = db.collection(USERS_COLLECTION).doc(userId)
//                     .collection(REMINDERS_COLLECTION)
//                     .orderBy('reminderDateTime', 'asc');

//       if (status) {
//         query = query.where('status', '==', status);
//       }

//       const snapshot = await query.get();
//       const reminders = [];
//       snapshot.forEach(doc => {
//         reminders.push({ id: doc.id, ...doc.data() });
//       });
//       return reminders;
//     } catch (error) {
//       console.error('ReminderService: Error getting reminders:', error);
//       throw error;
//     }
//   },

//   /**
//    * Updates an existing payment reminder.
//    * @param {string} userId - The ID of the user who owns the reminder.
//    * @param {string} reminderId - The ID of the reminder to update.
//    * @param {object} updateData - Fields to update (e.g., { objective, reminderDateTime, status }).
//    * @returns {Promise<object>} The updated reminder data.
//    * @throws {Error} If Firestore operation fails or reminder not found/permission denied.
//    */
//   async updateReminder(userId, reminderId, updateData) {
//     try {
//       const db = getFirestore(); //
//       const reminderRef = db.collection(USERS_COLLECTION).doc(userId)
//                             .collection(REMINDERS_COLLECTION).doc(reminderId);

//       const doc = await reminderRef.get();
//       if (!doc.exists) {
//         throw new Error('Reminder not found or you do not have permission to update it.');
//       }

//       // Ensure reminderDateTime is converted to Date if provided
//       if (updateData.reminderDateTime) {
//         updateData.reminderDateTime = new Date(updateData.reminderDateTime);
//       }

//       await reminderRef.update({
//         ...updateData,
//         updatedAt: admin.firestore.FieldValue.serverTimestamp(), //
//       });
//       console.log(`ReminderService: Reminder updated for UID: ${userId}, ReminderID: ${reminderId}`);
//       const updatedDoc = await reminderRef.get();
//       return { id: updatedDoc.id, ...updatedDoc.data() };
//     } catch (error) {
//       console.error('ReminderService: Error updating reminder:', error);
//       throw error;
//     }
//   },

//   /**
//    * Deletes a payment reminder.
//    * @param {string} userId - The ID of the user who owns the reminder.
//    * @param {string} reminderId - The ID of the reminder to delete.
//    * @returns {Promise<void>}
//    * @throws {Error} If Firestore operation fails or reminder not found/permission denied.
//    */
//   async deleteReminder(userId, reminderId) {
//     try {
//       const db = getFirestore(); //
//       const reminderRef = db.collection(USERS_COLLECTION).doc(userId)
//                             .collection(REMINDERS_COLLECTION).doc(reminderId);
      
//       const doc = await reminderRef.get();
//       if (!doc.exists) {
//         // To prevent information leakage about existence, you could also just proceed
//         // but for owner-based deletion, checking existence first is fine.
//         throw new Error('Reminder not found or you do not have permission to delete it.');
//       }

//       await reminderRef.delete();
//       console.log(`ReminderService: Reminder deleted for UID: ${userId}, ReminderID: ${reminderId}`);
//     } catch (error) {
//       console.error('ReminderService: Error deleting reminder:', error);
//       throw error;
//     }
//   },
// };

