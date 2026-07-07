import { Router } from 'express';
import auditRoutes from './audit.routes';

const router = Router();

router.use('/audit', auditRoutes);

export default router;
