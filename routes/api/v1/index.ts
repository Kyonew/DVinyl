import { Router } from 'express';
import accountRoutes from './accountRoutes';
import adminRoutes from './adminRoutes';
import authRoutes from './authRoutes';
import collectionsRoutes from './collectionsRoutes';
import collectionSettingsRoutes from './collectionSettingsRoutes';
import importExportRoutes from './importExportRoutes';
import itemsRoutes from './itemsRoutes';
import maintenanceRoutes from './maintenanceRoutes';
import pluginsRoutes from './pluginsRoutes';
import valuesRoutes from './valuesRoutes';

const router = Router();

router.use(accountRoutes);
router.use(adminRoutes);
router.use(authRoutes);
router.use(collectionsRoutes);
router.use(collectionSettingsRoutes);
router.use(importExportRoutes);
router.use(itemsRoutes);
router.use(maintenanceRoutes);
router.use(pluginsRoutes);
router.use(valuesRoutes);

router.use((err: any, req: any, res: any, next: any) => {
  console.error('[API] unhandled error:', err);
  if (res.headersSent) return next(err);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

export = router;
