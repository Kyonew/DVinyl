import express from 'express';
import User from '../models/User';
import { requireAuth, requireAdmin, requireCollectionRole } from '../middleware/authMiddleware';
import { sendBackupArchive } from '../core/backupArchive';
import {
    buildCollectionBackup,
    buildCollectionCsv,
    buildInstanceBackup,
    importCollectionBackup,
    importInstanceBackup,
    loadBackupArchive,
    receiveBackupArchive
} from '../utils/backupOperations';

const router = express.Router();

const requireInstanceImportAccess = async (req: any, res: any, next: any) => {
    try {
        const userCount = await User.countDocuments();
        if (userCount === 0 || res.locals.user?.isAdmin) return next();
        console.warn(`[SECURITY] import unauthorized : ${req.ip}`);
        return res.status(403).json({ error: 'Import unauthorized.' });
    } catch (err) {
        next(err);
    }
};

// ============ WHOLE-INSTANCE BACKUP (instance admin) ============

router.get('/export', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await buildInstanceBackup();
        const fileName = `dvinyl_instance_${new Date().toISOString().split('T')[0]}.json`;
        console.log(`[BACKUP] Instance export: ${data.users.length} user(s), ${data.albums.length} item(s), ${data.collections.length} collection(s)`);
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("[BACKUP] Instance export failed:", err);
        res.status(500).send("Export failed");
    }
});

router.get('/export-archive', requireAuth, requireAdmin, async (req, res) => {
    try {
        const data = await buildInstanceBackup();
        const fileName = `dvinyl_instance_${new Date().toISOString().split('T')[0]}.zip`;
        console.log(`[BACKUP] Instance archive export: ${data.users.length} user(s), ${data.albums.length} item(s), ${data.collections.length} collection(s)`);
        await sendBackupArchive(res, data, fileName);
    } catch (err) {
        console.error('[BACKUP] Instance archive export failed:', err);
        if (!res.headersSent) res.status(500).send('Export failed');
        else res.destroy(err as Error);
    }
});

router.post('/import', requireInstanceImportAccess, importInstanceBackup);
router.post(
    '/import-archive',
    requireInstanceImportAccess,
    receiveBackupArchive,
    loadBackupArchive,
    importInstanceBackup
);

// ============ PER-COLLECTION BACKUP (collection admin) ============

router.get('/collection/export', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const collection = res.locals.activeCollection;
        const data = await buildCollectionBackup(res.locals.activeCollectionId, collection);
        const slug = collection?.slug || 'collection';
        const fileName = `dvinyl_collection-${slug}_${new Date().toISOString().split('T')[0]}.json`;
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'application/json');
        res.send(JSON.stringify(data, null, 2));
    } catch (err) {
        console.error("[ERR] Collection export:", err);
        res.status(500).send("Export failed");
    }
});

router.get('/collection/export-archive', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const collection = res.locals.activeCollection;
        const data = await buildCollectionBackup(res.locals.activeCollectionId, collection);
        const slug = collection?.slug || 'collection';
        const fileName = `dvinyl_collection-${slug}_${new Date().toISOString().split('T')[0]}.zip`;
        await sendBackupArchive(res, data, fileName);
    } catch (err) {
        console.error('[BACKUP] Collection archive export failed:', err);
        if (!res.headersSent) res.status(500).send('Export failed');
        else res.destroy(err as Error);
    }
});

router.get('/collection/export-csv', requireAuth, requireCollectionRole('admin'), async (req: any, res: any) => {
    try {
        const { csv, fileName } = await buildCollectionCsv({
            req,
            collectionId: res.locals.activeCollectionId,
            collection: res.locals.activeCollection,
            settings: res.locals.settings
        });
        res.setHeader('Content-disposition', 'attachment; filename=' + fileName);
        res.setHeader('Content-type', 'text/csv; charset=utf-8');
        res.send(csv);
    } catch (err) {
        console.error("[ERR] Collection CSV export:", err);
        res.status(500).send("Export failed");
    }
});

router.post('/collection/import', requireAuth, requireCollectionRole('admin'), importCollectionBackup);
router.post(
    '/collection/import-archive',
    requireAuth,
    requireCollectionRole('admin'),
    receiveBackupArchive,
    loadBackupArchive,
    importCollectionBackup
);

export = router;
