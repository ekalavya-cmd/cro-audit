import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { ENV } from '../config/env';

const redisConnection = new IORedis({
  host: ENV.REDIS_HOST,
  port: ENV.REDIS_PORT,
  maxRetriesPerRequest: null,
});

async function clearQueue() {
  const queueName = 'audit_sequential';
  const queue = new Queue(queueName, { connection: redisConnection });

  console.log(`[Cleaner] Attempting to clear all jobs from queue: ${queueName}`);

  try {
    await queue.obliterate({ force: true });

    console.log(`[Cleaner] Success! Queue "${queueName}" has been obliterated.`);
  } catch (error) {
    console.error(`[Cleaner] Failed to clear queue:`, error);
  } finally {
    await queue.close();
    redisConnection.disconnect();
    process.exit(0);
  }
}

clearQueue();
