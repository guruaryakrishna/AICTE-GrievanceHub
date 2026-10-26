import { Router } from 'express';
import { authenticate } from '../middleware/auth';
import { originGuard } from '../middleware/originGuard';
import { count, list, markAllRead, markAsRead } from '../controllers/notificationController';

const router = Router();
router.use(authenticate);
router.get('/', list);
router.get('/unread-count', count);
router.post('/read-all', originGuard, markAllRead);
router.post('/:id/read', originGuard, markAsRead);
export default router;
