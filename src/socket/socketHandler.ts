import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import logger from '../utils/logger';
import IORedis from 'ioredis';
import { ENV } from '../config/env';

let io: SocketIOServer | null = null;

const redisPub = new IORedis({
  host: ENV.REDIS_HOST,
  port: ENV.REDIS_PORT,
});

const redisSub = new IORedis({
  host: ENV.REDIS_HOST,
  port: ENV.REDIS_PORT,
});

export interface ProgressPayload {
  jobId: string;
  progress: number;
  status: 'started' | 'processing' | 'completed' | 'failed';
  mode: string;
  currentStep?: string;
  message?: string;
}

export function initSocket(server: HTTPServer): SocketIOServer {
  io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    logger.info(`[Socket] Client connected: ${socket.id}`);

    socket.on('join', (jobId: string) => {
      if (jobId) {
        socket.join(jobId);
        logger.info(`[Socket] Client ${socket.id} joined room: ${jobId}`);
      }
    });

    socket.on('leave', (jobId: string) => {
      if (jobId) {
        socket.leave(jobId);
        logger.info(`[Socket] Client ${socket.id} left room: ${jobId}`);
      }
    });

    socket.on('disconnect', (reason) => {
      logger.info(`[Socket] Client ${socket.id} disconnected: ${reason}`);
    });
  });

  redisSub.subscribe('socket:events', (err) => {
    if (err) {
      logger.error('[Socket] Redis subscription error:', err);
    } else {
      logger.info('[Socket] Redis subscribed to socket:events');
    }
  });

  redisSub.on('message', (channel, message) => {
    if (channel === 'socket:events') {
      try {
        const event = JSON.parse(message);
        if (io) {
          io.to(event.jobId).emit(event.type, event.data);
          logger.info(`[Socket] Forwarded ${event.type} to room ${event.jobId}`);
        }
      } catch (e) {
        logger.error('[Socket] Failed to parse Redis message:', e);
      }
    }
  });

  logger.info('[Socket] Socket.IO server initialized');
  return io;
}

export function getIO(): SocketIOServer | null {
  return io;
}

export function emitProgress(jobId: string, payload: ProgressPayload): void {
  const event = {
    type: 'progress',
    jobId,
    data: payload,
  };
  redisPub.publish('socket:events', JSON.stringify(event));
  logger.info(
    `[Socket] Published progress to ${jobId}: ${payload.progress}% - ${payload.currentStep || ''}`,
  );
}

export function emitJobComplete(jobId: string, result: unknown): void {
  const event = {
    type: 'complete',
    jobId,
    data: { jobId, result },
  };
  redisPub.publish('socket:events', JSON.stringify(event));
  logger.info(`[Socket] Published complete to ${jobId}`);
}

export function emitJobFailed(jobId: string, error: string): void {
  const event = {
    type: 'failed',
    jobId,
    data: { jobId, error },
  };
  redisPub.publish('socket:events', JSON.stringify(event));
  logger.info(`[Socket] Published failed to ${jobId}`);
}
