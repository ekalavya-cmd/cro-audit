import { ERROR_CODES } from '../constants/errorCodes';
import { ApiError } from '../utils/appError';

export interface DetailErrorItem {
  field: string;
  message: string;
}

/*
|--------------------------------------------------------------------------
| Error Types
|--------------------------------------------------------------------------
*/

export class NotFoundError extends ApiError {
  constructor(
    message: string = ERROR_CODES.NOT_FOUND.message,
    type: string = ERROR_CODES.NOT_FOUND.code,
  ) {
    super(message, 404, type);
  }
}

export class BadRequestError extends ApiError {
  constructor(
    message: string = ERROR_CODES.BAD_REQUEST.message,
    type: string = ERROR_CODES.BAD_REQUEST.code,
  ) {
    super(message, 400, type);
  }
}

export class UnauthorizedError extends ApiError {
  constructor(
    message: string = ERROR_CODES.UNAUTHORIZED.message,
    type: string = ERROR_CODES.UNAUTHORIZED.code,
  ) {
    super(message, 401, type);
  }
}

export class ForbiddenError extends ApiError {
  constructor(
    message: string = ERROR_CODES.FORBIDDEN.message,
    type: string = ERROR_CODES.FORBIDDEN.code,
  ) {
    super(message, 403, type);
  }
}

export class InternalServerError extends ApiError {
  constructor(
    message: string = ERROR_CODES.SERVER_ERROR.message,
    type: string = ERROR_CODES.SERVER_ERROR.code,
  ) {
    super(message, 500, type);
  }
}

export class AlreadyExistsError extends ApiError {
  constructor(
    message: string = ERROR_CODES.ALREADY_EXISTS.message,
    type: string = ERROR_CODES.ALREADY_EXISTS.code,
  ) {
    super(message, 409, type);
  }
}

export class LoginError extends ApiError {
  constructor(
    message: string = ERROR_CODES.LOGIN_ERROR.message,
    type: string = ERROR_CODES.LOGIN_ERROR.code,
  ) {
    super(message, 401, type);
  }
}

export class TokenExpiredError extends ApiError {
  constructor(
    message: string = ERROR_CODES.TOKEN_EXPIRED.message,
    type: string = ERROR_CODES.TOKEN_EXPIRED.code,
  ) {
    super(message, 401, type);
  }
}

export class BadTokenError extends ApiError {
  constructor(
    message: string = ERROR_CODES.BAD_REQUEST.message,
    type: string = ERROR_CODES.BAD_REQUEST.code,
  ) {
    super(message, 401, type);
  }
}

export class ValidationError extends ApiError {
  details: DetailErrorItem[];

  constructor(
    message: string = ERROR_CODES.VALIDATION.message,
    type: string = ERROR_CODES.VALIDATION.code,
    details: DetailErrorItem[] = [],
  ) {
    super(message, 400, type);
    this.details = details;
  }
}
