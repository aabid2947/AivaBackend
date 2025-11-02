// src/routes/userDataRoutes.js
import express from 'express';
import { exportUserData, fetchAllUserData } from '../utils/userDataExporter.js';

const router = express.Router();

/**
 * Export all data for a specific user
 * GET /api/userdata/export/:userId
 */
router.get('/export/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        console.log(`[INFO] Manual user data export requested for: ${userId}`);
        
        const filePath = await exportUserData(userId);
        
        res.json({
            success: true,
            message: 'User data exported successfully',
            userId: userId,
            filePath: filePath,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[ERROR] Manual user data export failed:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to export user data',
            message: error.message
        });
    }
});

/**
 * Get user data count and summary (without saving to file)
 * GET /api/userdata/summary/:userId
 */
router.get('/summary/:userId', async (req, res) => {
    try {
        const { userId } = req.params;
        
        console.log(`[INFO] User data summary requested for: ${userId}`);
        
        const userData = await fetchAllUserData(userId);
        
        // Create summary without full data
        const summary = {
            userId: userData.userId,
            fetchedAt: userData.fetchedAt,
            totalCollections: Object.keys(userData.collections).length,
            collectionsWithData: Object.keys(userData.collections).filter(key => {
                const data = userData.collections[key];
                return Array.isArray(data) ? data.length > 0 : !!data;
            }),
            collectionCounts: {},
            totalDocuments: 0
        };
        
        // Count documents in each collection
        for (const [collectionName, data] of Object.entries(userData.collections)) {
            if (Array.isArray(data)) {
                summary.collectionCounts[collectionName] = data.length;
                summary.totalDocuments += data.length;
            } else if (data && data.profile) {
                summary.collectionCounts[collectionName] = 1;
                summary.totalDocuments += 1;
            }
        }
        
        res.json({
            success: true,
            summary: summary
        });
        
    } catch (error) {
        console.error('[ERROR] User data summary failed:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to get user data summary',
            message: error.message
        });
    }
});

/**
 * Export the specific target user data (RC0HRMUeGQVQtAzB3rMzukxnLb62)
 * GET /api/userdata/export-target
 */
router.get('/export-target', async (req, res) => {
    try {
        const TARGET_USER_ID = 'RC0HRMUeGQVQtAzB3rMzukxnLb62';
        
        console.log(`[INFO] Target user data export requested`);
        
        const filePath = await exportUserData(TARGET_USER_ID, `target_user_manual_export_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        
        res.json({
            success: true,
            message: 'Target user data exported successfully',
            userId: TARGET_USER_ID,
            filePath: filePath,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('[ERROR] Target user data export failed:', error.message);
        res.status(500).json({
            success: false,
            error: 'Failed to export target user data',
            message: error.message
        });
    }
});

export default router;