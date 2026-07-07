import { Worker, Job } from 'bullmq';
import { redisConnection } from './audit.queue';
import { AuditService } from '../audit.service';
import logger from '../../../utils/logger';
import { emitProgress, emitJobComplete, emitJobFailed } from '../../../socket/socketHandler';
import { Lead } from '../../../models/Lead';

const auditService = new AuditService();

const getProgressMilestones = (mode?: string): Record<string, number> => {
  const milestones: Record<string, Record<string, number>> = {
    seo: {
      started: 0,
      lighthouse: 30,
      dom_nav: 50,
      dom_seo: 70,
      scoring: 90,
      complete: 100,
    },
    uxui: {
      started: 0,
      lighthouse: 20,
      axe: 35,
      dom_nav: 50,
      dom_seo: 60,
      visual_mobile: 75,
      visual_trust: 85,
      scoring: 95,
      complete: 100,
    },
    full: {
      started: 0,
      lighthouse: 15,
      axe: 30,
      dom_nav: 45,
      dom_seo: 60,
      visual_mobile: 75,
      visual_trust: 85,
      scoring: 95,
      complete: 100,
    },
  };
  return milestones[mode || 'full'];
};

export const auditWorker = new Worker(
  'audit_sequential',
  async (job: Job) => {
    const { url, mode, emailRecipient, jobId, leadId } = job.data;
    const modeKey = mode || 'full';
    const milestones = getProgressMilestones(modeKey);

    logger.info(
      `[Worker] Starting audit job ${job.id} for ${url} in ${modeKey} mode, jobId: ${jobId}, leadId: ${leadId}`,
    );

    const reportProgress = (step: string, progress: number) => {
      job.updateProgress({ progress, currentStep: step });
      emitProgress(job.id!, {
        jobId: job.id!,
        progress,
        status: 'processing',
        mode: modeKey,
        currentStep: step,
      });
    };

    reportProgress('started', milestones.started);

    try {
      const result = await auditService.runFullAudit(url, mode, emailRecipient, job.id, (step) => {
        const progress = milestones[step] ?? 50;
        reportProgress(step, progress);
      });

      reportProgress('complete', milestones.complete);

      // Update lead with audit result - always use leadId (_id) as primary
      const leadIdToUse = leadId;

      logger.info(
        `[Worker] Attempting to update lead with leadId: ${leadIdToUse}, jobId: ${jobId}, job.id: ${job.id}`,
      );

      logger.info(`[Worker] Audit results ready. Updating lead record...`);
      try {
        const plainResult = JSON.parse(JSON.stringify(result));

        let updateResult = null;

        // Always try by leadId (MongoDB _id) as primary - this is the most reliable
        if (leadIdToUse) {
          updateResult = await Lead.findByIdAndUpdate(leadIdToUse, {
            auditResult: plainResult,
            status: 'completed',
          });

          if (updateResult) {
            logger.info(`[Worker] Lead updated successfully via leadId: ${leadIdToUse}`);
          }
        }

        // Fallback: try by jobId if leadId didn't work
        if (!updateResult && jobId) {
          logger.warn(`[Worker] No lead found by leadId, trying by jobId: ${jobId}`);
          updateResult = await Lead.findOneAndUpdate(
            { jobId: jobId },
            {
              auditResult: plainResult,
              status: 'completed',
            },
          );

          if (updateResult) {
            logger.info(`[Worker] Lead updated successfully via jobId: ${jobId}`);
          }
        }

        // Last fallback: try by BullMQ job.id
        if (!updateResult) {
          logger.warn(`[Worker] No lead found by jobId, trying by job.id: ${job.id}`);
          updateResult = await Lead.findOneAndUpdate(
            { jobId: String(job.id) },
            {
              auditResult: plainResult,
              status: 'completed',
            },
          );

          if (updateResult) {
            logger.info(`[Worker] Lead updated successfully via job.id: ${job.id}`);
          }
        }

        if (!updateResult) {
          logger.error(`[Worker] Failed to find and update lead with any method`);
        }
      } catch (leadError) {
        logger.error(`[Worker] Failed to update lead:`, leadError);
      }

      logger.info(`[Worker] Emitting complete event for job.id: ${job.id}`);
      emitJobComplete(job.id!, result);
      logger.info(`[Worker] Audit job ${job.id} completed successfully`);

      return {
        status: 'completed',
        data: result,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`[Worker] Audit job ${job.id} failed:`, errorMessage);
      logger.info(`[Worker] Emitting failed event for job.id: ${job.id}`);

      // Update lead status to failed
      if (jobId) {
        await Lead.findOneAndUpdate({ jobId }, { status: 'failed' });
      }

      emitJobFailed(job.id!, errorMessage);
      throw error;
    }
  },
  {
    connection: redisConnection,
    concurrency: 1,
    lockDuration: 600000,
  },
);

auditWorker.on('completed', (job) => {
  logger.info(`[Worker] Job ${job.id} has completed!`);
});

auditWorker.on('failed', (job, err) => {
  logger.error(`[Worker] Job ${job?.id} has failed with ${err.message}`);
});
