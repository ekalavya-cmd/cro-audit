export class BaseError extends Error {
  type: string;
  statusCode: number;
  isOperational: boolean;

  constructor(message: string, statusCode: number, type: string, isOperational = true) {
    super(message);

    this.type = type;
    this.statusCode = statusCode;
    this.isOperational = isOperational;

    Object.setPrototypeOf(this, new.target.prototype);
    Error.captureStackTrace(this);
  }
}

export class ApiError extends BaseError {
  constructor(message: string, statusCode: number, type: string) {
    super(message, statusCode, type, true);
  }
}

export const isApiError = (err: Error): boolean =>
  err instanceof ApiError ? err.isOperational : false;
