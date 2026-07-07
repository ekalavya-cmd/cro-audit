import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ENV } from '../../../config/env';

export const redisConnection = new IORedis({
  host: ENV.REDIS_HOST,
  port: ENV.REDIS_PORT,
  maxRetriesPerRequest: null,
});

export const auditQueue = new Queue('audit_sequential', {
  connection: redisConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000,
    },
    removeOnComplete: {
      count: 100, // Keep last 100 jobs
      age: 3600, // Keep for 1 hour (in seconds)
    },
    removeOnFail: false,
  },
});
