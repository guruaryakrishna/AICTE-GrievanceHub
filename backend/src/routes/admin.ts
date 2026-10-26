import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { originGuard } from '../middleware/originGuard';
import * as admin from '../controllers/adminController';

const router = Router();
router.use(authenticate, authorize('ADMIN'));

router.get('/users', admin.listUsers);
router.post('/users', originGuard, admin.createUser);
router.patch('/users/:id', originGuard, admin.updateUser);

router.get('/bureaus', admin.listBureaus);
router.post('/bureaus', originGuard, admin.createBureau);
router.patch('/bureaus/:id', originGuard, admin.updateBureau);

router.get('/regions', admin.listRegions);
router.post('/regions', originGuard, admin.createRegion);
router.patch('/regions/:id', originGuard, admin.updateRegion);

router.get('/categories', admin.listCategories);
router.post('/categories', originGuard, admin.createCategory);
router.patch('/categories/:id', originGuard, admin.updateCategory);

router.get('/audit', admin.listAuditEvents);
router.get('/sla-rules', admin.listSlaRules);
router.post('/sla-rules', originGuard, admin.createSlaRule);
router.patch('/sla-rules/:id', originGuard, admin.updateSlaRule);

export default router;
