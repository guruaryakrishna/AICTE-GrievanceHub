import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { originGuard } from '../middleware/originGuard';
import { exportAlerts, exportCases, exportInstitutions, runSla, summary } from '../controllers/reportController';

const router = Router();
router.use(authenticate);
router.get('/summary', summary);
router.get('/export/cases', exportCases);
router.get('/export/alerts', exportAlerts);
router.get('/export/institutions', exportInstitutions);
router.post('/sla/evaluate', originGuard, runSla);
export default router;
