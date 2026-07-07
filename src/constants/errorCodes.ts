export interface ErrorDetails {
  code: string;
  message: string;
}

export const ERROR_CODES: Record<string, ErrorDetails> = {
  TOKEN_EXPIRED: {
    code: 'TOKEN_EXPIRED',
    message: 'Your session has expired. Please log in again.',
  },

  LOGIN_ERROR: {
    code: 'UNAUTHORIZED',
    message: 'The email or password you entered is incorrect. Please check and try again.',
  },

  UNAUTHORIZED: {
    code: 'UNAUTHORIZED',
    message: 'Your session has timed out. For continued access, kindly log in again.',
  },

  SERVER_ERROR: {
    code: 'SERVER_ERROR',
    message: 'Internal server error. Please try again later.',
  },

  NOT_FOUND: {
    code: 'NOT_FOUND',
    message: 'The requested resource could not be found.',
  },

  BAD_REQUEST: {
    code: 'BAD_REQUEST',
    message: 'Bad request. Please check the data you provided.',
  },

  FORBIDDEN: {
    code: 'FORBIDDEN',
    message: 'You do not have permission to access this resource.',
  },

  VALIDATION: {
    code: 'VALIDATION_ERROR',
    message: 'Validation error. Please check the data you entered.',
  },

  ALREADY_EXISTS: {
    code: 'RESOURCE_ALREADY_EXISTS',
    message: 'The resource already exists.',
  },
};
