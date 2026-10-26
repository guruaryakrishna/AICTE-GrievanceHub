import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { originGuard } from '../middleware/originGuard';
import { addAction, assign, create, dispose, escalate, getById, list, officers, reopen, transfer, updateStatus } from '../controllers/caseController';

const router = Router();

router.use(authenticate);
router.get('/', list);
router.get('/meta/officers', officers);
router.post('/', originGuard, create);
router.get('/:id', getById);
router.post('/:id/status', originGuard, updateStatus);
router.post('/:id/actions', originGuard, addAction);
router.post('/:id/assign', originGuard, assign);
router.post('/:id/transfer', originGuard, transfer);
router.post('/:id/escalate', originGuard, escalate);
router.post('/:id/dispose', originGuard, dispose);
router.post('/:id/reopen', originGuard, reopen);

export default router;
