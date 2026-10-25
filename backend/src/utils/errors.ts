export class AppError extends Error {
  statusCode: number;
  code: string;
  details?: unknown;

  constructor(statusCode: number, message: string, code = 'APP_ERROR', details?: unknown) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
  }
}

export const BadRequest = (message: string, details?: unknown) =>
  new AppError(400, message, 'BAD_REQUEST', details);
export const Unauthorized = (message = 'Authentication required') =>
  new AppError(401, message, 'UNAUTHORIZED');
export const Forbidden = (message = 'You do not have permission to perform this action') =>
  new AppError(403, message, 'FORBIDDEN');
export const NotFound = (message = 'Resource not found') =>
  new AppError(404, message, 'NOT_FOUND');
export const Conflict = (message: string, details?: unknown) =>
  new AppError(409, message, 'CONFLICT', details);
