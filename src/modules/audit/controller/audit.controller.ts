import { Request, Response } from 'express';
import { emailService } from '../email/email.service';
import { asyncHandler } from '../../../utils/asyncHandler';
import { auditQueue, redisConnection } from '../queue/audit.queue';
import { Lead } from '../../../models/Lead';

export const runAudit = asyncHandler(async (req: Request, res: Response) => {
  const { url, mode, notifyViaEmail, email } = req.body;

  if (!url) {
    return res.status(400).json({ message: 'URL is required' });
  }

  if (!url.startsWith('https://')) {
    return res.status(400).json({ message: 'Only SSL certified websites (https://) are allowed' });
  }

  // Basic URL validation
  try {
    new URL(url);
  } catch {
    return res.status(400).json({ message: 'Invalid URL format' });
  }

  const emailRecipient = notifyViaEmail && email ? email : undefined;

  const jobId = `audit_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

  // Create lead record in MongoDB
  const lead = await Lead.create({
    email: email || '',
    websiteUrl: url,
    mode: mode || 'full',
    status: 'pending',
    jobId,
  });

  // Add job to the sequential queue
  const job = await auditQueue.add(
    'process_audit',
    {
      url,
      mode,
      emailRecipient,
      email,
      leadId: lead._id.toString(),
      jobId,
    },
    {
      jobId,
    },
  );

  // Track email in Redis for simple lookups
  if (email) {
    await redisConnection.sadd('audit:emails', email);
    await redisConnection.sadd(`audit:email:${email}:jobs`, job.id!);
  }

  res.status(202).json({
    status: 'queued',
    message: 'Audit has been added to the queue',
    jobId: job.id,
    customJobId: jobId,
    leadId: lead._id,
  });
});

export const getAllEmails = asyncHandler(async (req: Request, res: Response) => {
  const emails = await redisConnection.smembers('audit:emails');

  const emailsWithStats = await Promise.all(
    emails.map(async (email) => {
      const jobCount = await redisConnection.scard(`audit:email:${email}:jobs`);
      return {
        email,
        auditCount: jobCount,
      };
    }),
  );

  res.status(200).json({
    status: 'success',
    totalUniqueEmails: emails.length,
    data: emailsWithStats,
  });
});

export const getAuditStatus = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;

  if (!jobId) {
    return res.status(400).json({ message: 'Job ID is required' });
  }

  console.log(`[API] Polling status for jobId: ${jobId}`);
  const job = await auditQueue.getJob(jobId);

  if (!job) {
    return res.status(404).json({ message: 'Job not found' });
  }

  const state = await job.getState();
  const result = job.returnvalue;

  let progressNum = 0;
  let currentStep: string | undefined = undefined;
  if (typeof job.progress === 'number') {
    progressNum = job.progress;
  } else if (job.progress && typeof job.progress === 'object') {
    const progressObj = job.progress as { progress?: number; currentStep?: string };
    progressNum = progressObj.progress ?? 0;
    currentStep = progressObj.currentStep;
  }

  res.status(200).json({
    jobId: job.id,
    status: state,
    email: job.data.email,
    url: job.data.url,
    progress: progressNum,
    currentStep: currentStep,
    result: result?.data || null,
    error: job.failedReason || null,
    timestamp: job.timestamp,
  });
});

export const sendReportEmail = asyncHandler(async (req: Request, res: Response) => {
  const { email, data } = req.body;

  if (!email) {
    return res.status(400).json({ message: 'Email is required' });
  }

  if (!data) {
    return res.status(400).json({ message: 'Report data is required' });
  }

  const {
    url,
    mode,
    grade,
    score,
    label,
    message,
    breakdown,
    quickWins,
    recommendations,
    criticalIssueCount,
    timestamp,
  } = data;

  try {
    await emailService.sendAuditReport(email, {
      url: url || '',
      mode: mode as 'seo' | 'uxui' | 'full' | undefined,
      score: score || 0,
      grade: grade || 'N/A',
      label: label || '',
      breakdown: breakdown || {},
      metrics: (data as { metrics?: Record<string, string | number> }).metrics,
      quickWins: quickWins || [],
      recommendations,
      criticalIssueCount: criticalIssueCount || 0,
      message: message || '',
      timestamp: timestamp || new Date().toISOString(),
    });

    res.status(200).json({
      status: 'success',
      message: 'Report sent to ' + email,
    });
  } catch (error) {
    console.log(
      'Failed to send report email:',
      error instanceof Error ? error.message : String(error),
    );
    res.status(500).json({ message: 'Failed to send email' });
  }
});
