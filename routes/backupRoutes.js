const express = require('express');
const router = express.Router();
const Album = require('../models/Album');
const User = require('../models/User');
const LoginLog = require('../models/LoginLog');
const { requireAuth, requireAdmin } = require('../middleware/authMiddleware');

/**
 * routes/backupRoutes.js
 *
 * Backup and restore endpoints for the application data.
 *
 * - GET /export:    Authenticated admin-only endpoint that streams a JSON
 *                   backup containing users, albums and login logs.
 * - POST /import:   Endpoint that accepts a JSON backup payload and restores
 *                   the database collections. Intended for admin use.
 *
 * These routes use the standard `requireAuth` and `requireAdmin` middleware
 * where appropriate. Responses are JSON for the import endpoint and a file
 * attachment for the export endpoint.
 */

/**
 * GET /export
 *
 * Export the current database state as a JSON file. This endpoint is
 * protected: only authenticated administrators may request a backup.
 *
 * Response:
 * - Attachment: JSON file containing `users`, `albums`, `logs` and `metadata`.
 * - 500 on server error.
 */
router.get('/export', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = {
            users: await User.find({}).lean(),
            albums: await Album.find({}).lean(),
            logs: await LoginLog.find({}).lean(),
            metadata: {
                version: "1.0.0",
                date: new Date()
            }
        };

        const fileName = `dvinyl_backup_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error(err);
        res.status(500).send("Export failed");
    }
});

/**
 * POST /import
 *
 * Import a previously exported backup JSON. The payload may be either a
 * direct JSON body with the expected structure or an object containing
 * `backupData` (stringified JSON or object).
 *
 * Expected structure:
 * {
 *   users: [...],
 *   albums: [...],
 *   logs: [...]
 * }
 *
 * Behavior:
 * - Clears existing `LoginLog`, `Album` and `User` collections.
 * - Inserts provided arrays into their respective collections.
 * - Clears the `jwt` cookie to force re-login after restore.
 *
 * Returns:
 * - 200 { success: true } on success
 * - 400 on invalid payload
 * - 500 on server error
 */
router.post('/import', async (req, res) => {
    try {
        let data = req.body;

        if (data.backupData) {
            data = typeof data.backupData === 'string' ? JSON.parse(data.backupData) : data.backupData;
        }

        if (!data || !data.users) {
            return res.status(400).json({ error: "Invalid backup data" });
        }

        await Promise.all([
            LoginLog.deleteMany({}),
            Album.deleteMany({}),
            User.deleteMany({})
        ]);

        if (data.users && data.users.length > 0) await User.insertMany(data.users);
        if (data.albums && data.albums.length > 0) await Album.insertMany(data.albums);
        if (data.logs && data.logs.length > 0) await LoginLog.insertMany(data.logs);

        res.cookie('jwt', '', { maxAge: 1 });
        res.status(200).json({ success: true });

    } catch (err) {
        console.error("Erreur Import Backup :", err);
        res.status(500).json({ error: "Internal error" });
    }
});


module.exports = router;