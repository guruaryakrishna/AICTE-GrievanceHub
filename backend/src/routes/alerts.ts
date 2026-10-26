import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { originGuard } from '../middleware/originGuard';
import { evaluate, getById, list, review } from '../controllers/alertController';

const router = Router();

router.use(authenticate);
router.get('/', list);
router.get('/:id', getById);
router.post('/:id/review', originGuard, review);
router.post('/evaluate/run', originGuard, evaluate);

export default router;
