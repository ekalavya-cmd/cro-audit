import { Request, Response, NextFunction } from 'express';
import logger from '../utils/logger';
import { ApiError } from '../utils/appError';

export function handleJsonSyntaxError(
  err: SyntaxError,
  req: Request,
  res: Response,
  next: NextFunction,
) {
  if (err instanceof SyntaxError && 'body' in err) {
    const message = 'Invalid JSON format';

    logger.error({
      message,
      stack: err.stack,
      path: req.originalUrl,
      method: req.method,
      statusCode: 400,
    });

    return res.status(400).json({ success: false, message });
  }

  next(err);
}

export function errorHandler(err: Error, req: Request, res: Response, _next: NextFunction) {
  let statusCode = 500;
  let message = 'Internal server error';

  if (err instanceof ApiError) {
    statusCode = err.statusCode;
    message = err.message;
  }

  logger.error({
    message,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
    statusCode,
  });

  return res.status(statusCode).json({ success: false, message });
}
