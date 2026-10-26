import { Router } from 'express';
import { login, logout, me } from '../controllers/authController';
import { authenticate } from '../middleware/auth';
import { originGuard } from '../middleware/originGuard';
import { rateLimit } from '../middleware/security';

const router = Router();
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, keyPrefix: 'login' });

router.post('/login', loginLimiter, originGuard, login);
router.get('/me', authenticate, me);
router.post('/logout', originGuard, authenticate, logout);

export default router;
