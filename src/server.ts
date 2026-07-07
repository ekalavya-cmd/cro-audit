import app from './app';
import logger from './utils/logger';
import { ENV } from './config/env';
import { createServer } from 'http';
import { initSocket } from './socket/socketHandler';
import connectDB from './config/mongodb';

async function start() {
  await connectDB();

  const httpServer = createServer(app);

  initSocket(httpServer);

  httpServer.listen(ENV.PORT, () => {
    logger.info(`Server running on port ${ENV.PORT}`);
    logger.info(`Documentation available at http://localhost:${ENV.PORT}/docs`);
    logger.info(`Socket.IO initialized on port ${ENV.PORT}`);
  });
}

start();
