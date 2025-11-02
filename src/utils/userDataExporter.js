// src/utils/userDataExporter.js
import { db } from '../config/firebaseAdmin.js';
import fs from 'fs/promises';
import path from 'path';

/**
 * Fetch all documents for a specific user from all collections
 * @param {string} userId - The user ID to fetch data for
 * @returns {Promise<Object>} User data from all collections
 */
export async function fetchAllUserData(userId) {
    console.log(`[INFO] Fetching all data for user: ${userId}`);
    
    const userData = {
        userId: userId,
        fetchedAt: new Date().toISOString(),
        collections: {}
    };

    try {
        // Define collections that might contain user data
        const collectionsToCheck = [
            'users',
            'appointments', 
            'reminders',
            'tokens',
            'notifications',
            'conversations',
            'callHistory',
            'userPreferences',
            'medicalRecords',
            'documents'
        ];

        // Fetch user profile from users collection
        console.log(`[INFO] Fetching user profile...`);
        const userDoc = await db.collection('users').doc(userId).get();
        if (userDoc.exists) {
            userData.collections.users = {
                profile: {
                    id: userDoc.id,
                    ...userDoc.data()
                }
            };
            console.log(`[INFO] ✅ Found user profile`);
        } else {
            console.log(`[WARN] ❌ User profile not found in users collection`);
        }

        // Check for user data in subcollections and related documents
        for (const collectionName of collectionsToCheck) {
            try {
                console.log(`[INFO] Checking collection: ${collectionName}`);
                
                // Method 1: Direct user document subcollections
                if (collectionName !== 'users') {
                    const userSubCollection = await db.collection('users').doc(userId).collection(collectionName).get();
                    if (!userSubCollection.empty) {
                        userData.collections[`users_${collectionName}`] = userSubCollection.docs.map(doc => ({
                            id: doc.id,
                            ...doc.data()
                        }));
                        console.log(`[INFO] ✅ Found ${userSubCollection.size} documents in users/${userId}/${collectionName}`);
                    }
                }

                // Method 2: Top-level collections with userId field
                const topLevelQuery = await db.collection(collectionName).where('userId', '==', userId).get();
                if (!topLevelQuery.empty) {
                    if (!userData.collections[collectionName]) {
                        userData.collections[collectionName] = [];
                    }
                    const docs = topLevelQuery.docs.map(doc => ({
                        id: doc.id,
                        ...doc.data()
                    }));
                    userData.collections[collectionName].push(...docs);
                    console.log(`[INFO] ✅ Found ${topLevelQuery.size} documents in ${collectionName} with userId`);
                }

                // Method 3: Collection groups (for nested collections)
                try {
                    const collectionGroupQuery = await db.collectionGroup(collectionName).where('userId', '==', userId).get();
                    if (!collectionGroupQuery.empty) {
                        const groupKey = `${collectionName}_collectionGroup`;
                        userData.collections[groupKey] = collectionGroupQuery.docs.map(doc => ({
                            id: doc.id,
                            path: doc.ref.path,
                            ...doc.data()
                        }));
                        console.log(`[INFO] ✅ Found ${collectionGroupQuery.size} documents in collection group ${collectionName}`);
                    }
                } catch (groupError) {
                    // Some collections might not support collection group queries
                    console.log(`[DEBUG] Collection group query not supported for ${collectionName}`);
                }

            } catch (error) {
                console.error(`[ERROR] Failed to fetch from collection ${collectionName}:`, error.message);
            }
        }

        // Special queries for specific data patterns
        await fetchSpecialUserData(userId, userData);

        // Count total documents found
        let totalDocs = 0;
        for (const [collectionName, data] of Object.entries(userData.collections)) {
            if (Array.isArray(data)) {
                totalDocs += data.length;
            } else if (data.profile) {
                totalDocs += 1;
            }
        }

        console.log(`[INFO] ✅ Total documents found for user ${userId}: ${totalDocs}`);
        console.log(`[INFO] Collections with data: ${Object.keys(userData.collections).join(', ')}`);

        return userData;

    } catch (error) {
        console.error(`[ERROR] Failed to fetch user data for ${userId}:`, error.message);
        throw error;
    }
}

/**
 * Fetch special user data patterns (contacts, preferences, etc.)
 * @param {string} userId - User ID
 * @param {Object} userData - User data object to populate
 */
async function fetchSpecialUserData(userId, userData) {
    try {
        // Check for user contact information
        const contactsQuery = await db.collection('contacts').where('ownerId', '==', userId).get();
        if (!contactsQuery.empty) {
            userData.collections.contacts = contactsQuery.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            console.log(`[INFO] ✅ Found ${contactsQuery.size} contacts`);
        }

        // Check for user phone numbers
        const phoneQuery = await db.collection('phoneNumbers').where('userId', '==', userId).get();
        if (!phoneQuery.empty) {
            userData.collections.phoneNumbers = phoneQuery.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            console.log(`[INFO] ✅ Found ${phoneQuery.size} phone numbers`);
        }

        // Check for user sessions
        const sessionsQuery = await db.collection('sessions').where('userId', '==', userId).get();
        if (!sessionsQuery.empty) {
            userData.collections.sessions = sessionsQuery.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            console.log(`[INFO] ✅ Found ${sessionsQuery.size} sessions`);
        }

        // Check for user devices/tokens
        const devicesQuery = await db.collection('devices').where('userId', '==', userId).get();
        if (!devicesQuery.empty) {
            userData.collections.devices = devicesQuery.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            console.log(`[INFO] ✅ Found ${devicesQuery.size} devices`);
        }

    } catch (error) {
        console.error(`[ERROR] Failed to fetch special user data:`, error.message);
    }
}

/**
 * Save user data to a JSON file
 * @param {Object} userData - User data to save
 * @param {string} fileName - Optional custom file name
 */
export async function saveUserDataToFile(userData, fileName = null) {
    try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const defaultFileName = `user_data_${userData.userId}_${timestamp}.json`;
        const finalFileName = fileName || defaultFileName;
        
        // Create exports directory if it doesn't exist
        const exportsDir = path.join(process.cwd(), 'exports');
        await fs.mkdir(exportsDir, { recursive: true });
        
        const filePath = path.join(exportsDir, finalFileName);
        
        // Format the data nicely
        const formattedData = {
            ...userData,
            summary: {
                userId: userData.userId,
                fetchedAt: userData.fetchedAt,
                totalCollections: Object.keys(userData.collections).length,
                collectionsWithData: Object.keys(userData.collections).filter(key => {
                    const data = userData.collections[key];
                    return Array.isArray(data) ? data.length > 0 : !!data;
                }),
                totalDocuments: Object.values(userData.collections).reduce((total, data) => {
                    if (Array.isArray(data)) return total + data.length;
                    if (data && data.profile) return total + 1;
                    return total;
                }, 0)
            }
        };
        
        await fs.writeFile(filePath, JSON.stringify(formattedData, null, 2), 'utf8');
        
        console.log(`[INFO] ✅ User data saved to: ${filePath}`);
        console.log(`[INFO] File size: ${(await fs.stat(filePath)).size} bytes`);
        
        return filePath;
        
    } catch (error) {
        console.error(`[ERROR] Failed to save user data to file:`, error.message);
        throw error;
    }
}

/**
 * Export user data for a specific user ID
 * @param {string} userId - User ID to export data for
 * @param {string} fileName - Optional custom file name
 * @returns {Promise<string>} Path to the saved file
 */
export async function exportUserData(userId, fileName = null) {
    console.log(`[INFO] 🚀 Starting user data export for: ${userId}`);
    
    try {
        // Fetch all user data
        const userData = await fetchAllUserData(userId);
        
        // Save to file
        const filePath = await saveUserDataToFile(userData, fileName);
        
        console.log(`[INFO] ✅ User data export completed successfully`);
        console.log(`[INFO] 📁 Exported file: ${filePath}`);
        
        return filePath;
        
    } catch (error) {
        console.error(`[ERROR] ❌ User data export failed:`, error.message);
        throw error;
    }
}

/**
 * Export data for the specific user on server startup
 */
export async function exportUserDataOnStartup() {
    const TARGET_USER_ID = 'RC0HRMUeGQVQtAzB3rMzukxnLb62';
    
    console.log(`[INFO] 🔄 Starting automatic user data export on server startup...`);
    
    try {
        const filePath = await exportUserData(TARGET_USER_ID, `user_${TARGET_USER_ID}_startup_export.json`);
        console.log(`[INFO] 🎉 Startup user data export completed: ${filePath}`);
    } catch (error) {
        console.error(`[ERROR] 💥 Startup user data export failed:`, error.message);
        // Don't throw - we don't want to crash the server if export fails
    }
}