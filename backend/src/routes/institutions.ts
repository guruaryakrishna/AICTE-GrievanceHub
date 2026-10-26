import { Router } from 'express';
import { authenticate, authorize } from '../middleware/auth';
import { originGuard } from '../middleware/originGuard';
import {
  addAlias,
  createInstitutionRecord,
  getIdentityResolutions,
  getIdentityResolutionStats,
  getInstitutionById,
  getInstitutions,
  listBureaus,
  listCategories,
  listRegions,
  matchInstitutions,
  merge,
  resolveIdentity,
  updateInstitutionRecord,
} from '../controllers/institutionController';

const router = Router();

router.use(authenticate);
router.get('/', getInstitutions);
router.get('/match', matchInstitutions);
router.get('/meta/regions', listRegions);
router.get('/meta/bureaus', listBureaus);
router.get('/meta/categories', listCategories);
router.get('/identity/queue', getIdentityResolutions);
router.get('/identity/stats', getIdentityResolutionStats);
router.post('/identity/:id/resolve', originGuard, authorize('ADMIN', 'REGIONAL_OFFICER'), resolveIdentity);
router.get('/:id', getInstitutionById);
router.post('/', originGuard, authorize('ADMIN', 'REGIONAL_OFFICER'), createInstitutionRecord);
router.patch('/:id', originGuard, authorize('ADMIN', 'REGIONAL_OFFICER'), updateInstitutionRecord);
router.post('/:id/aliases', originGuard, authorize('ADMIN', 'REGIONAL_OFFICER'), addAlias);
router.post('/:id/merge', originGuard, authorize('ADMIN'), merge);

export default router;
