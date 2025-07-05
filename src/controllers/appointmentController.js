// src/controllers/appointmentController.js
import { db } from '../config/firebaseAdmin.js';

// Get all appointments for a user
export const getUserAppointments = async (req, res) => {
    try {
        const { userId } = req.params;
        const appointmentsRef = db.collection('users').doc(userId).collection('appointments');
        const snapshot = await appointmentsRef.orderBy('createdAt', 'desc').get();

        if (snapshot.empty) {
            return res.status(200).json([]);
        }

        const appointments = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        res.status(200).json(appointments);

    } catch (error) {
        console.error('Error fetching user appointments:', error);
        res.status(500).json({ message: 'Failed to fetch appointments.' });
    }
};

// Get a specific appointment
export const getAppointmentDetails = async (req, res) => {
    try {
        const { userId, appointmentId } = req.params;
        const appointmentRef = db.collection('users').doc(userId).collection('appointments').doc(appointmentId);
        const doc = await appointmentRef.get();

        if (!doc.exists) {
            return res.status(404).json({ message: 'Appointment not found.' });
        }

        res.status(200).json({ id: doc.id, ...doc.data() });

    } catch (error) {
        console.error('Error fetching appointment details:', error);
        res.status(500).json({ message: 'Failed to fetch appointment details.' });
    }
};
