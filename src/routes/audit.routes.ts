import { Router } from 'express';
import * as auditController from '../modules/audit/controller/audit.controller';

const auditRoutes = Router();

auditRoutes.post('/run', auditController.runAudit);
auditRoutes.get('/status/:jobId', auditController.getAuditStatus);
auditRoutes.get('/emails', auditController.getAllEmails);
auditRoutes.post('/send-report', auditController.sendReportEmail);

export default auditRoutes;
