import express from 'express';
import Item from '../models/Item';
import User from '../models/User';
import LoginLog from '../models/LoginLog';
import Settings from '../models/Settings';
import { requireAuth, requireAdmin } from '../middleware/authMiddleware';
import { registry } from '../core/registry';

const router = express.Router();

router.get('/export', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = {
            users: await User.find({}).lean(),
            albums: await Item.find({}).lean(),
            logs: await LoginLog.find({}).lean(),
            settings: await Settings.findOne().lean(),
            metadata: {
                version: "2.0.0",
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
 */
router.post('/import', async (req, res) => {
    try {
        const userCount = await User.countDocuments();

        if (userCount > 0) {
            const currentUser = res.locals.user;

            if (!currentUser || !currentUser.isAdmin) {
                console.warn(`[SECURITY] import unauthorized : ${req.ip}`);
                return res.status(403).json({
                    error: "Import unauthorized."
                });
            }
        }

        // Setup
        let data = req.body;

        if (data.backupData) {
            try {
                data = typeof data.backupData === 'string' ? JSON.parse(data.backupData) : data.backupData;
            } catch (e) {
                return res.status(400).json({ error: "Invalid JSON format" });
            }
        }

        if (!data || (!data.users && !data.albums)) {
            return res.status(400).json({ error: "Backup file missing required fields" });
        }

        await Promise.all([
            LoginLog.deleteMany({}),
            Item.deleteMany({}),
            User.deleteMany({}),
            Settings.deleteMany({})
        ]);

        if (data.users && data.users.length > 0) {
            await User.insertMany(data.users);
        }

        if (data.albums && data.albums.length > 0) {
            // Legacy backups may hold items without a `kind`; assign the plugin that claims legacy items
            const legacyKind = registry.getAll().find(p => p.matchesLegacyItems)?.kind || 'Music';
            const cleanAlbums = data.albums.map((album: any) => {
                if (!album.kind) return { ...album, kind: legacyKind };
                return album;
            });
            await Item.insertMany(cleanAlbums);
        }

        if (data.logs && data.logs.length > 0) {
            await LoginLog.insertMany(data.logs);
        }

        if (data.settings) {
            await Settings.create(data.settings);
        } else {
            await Settings.create({});
        }
        res.cookie('jwt', '', { maxAge: 1 });
        res.status(200).json({ success: true, message: "Import successful" });

    } catch (err: any) {
        console.error("[ERR] Import :", err);
        res.status(500).json({ error: err.message });
    }
});

export = router;