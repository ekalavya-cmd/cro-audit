import connectDB from './config/mongodb';
import './modules/audit/queue/audit.worker';
import logger from './utils/logger';

async function startWorker() {
  await connectDB();
  logger.info('Background Audit Worker started successfully');

  // Keep process alive
  process.on('SIGTERM', async () => {
    logger.info('Worker shutting down...');
    process.exit(0);
  });

  process.on('SIGINT', async () => {
    logger.info('Worker interrupted...');

    process.exit(0);
  });
}

startWorker();
