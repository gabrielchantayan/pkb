import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export interface ApiError extends Error {
  status_code?: number;
}

export function error_middleware(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status_code = err.status_code || 500;
  const message = err.message || 'Internal server error';

  logger.error('request error', {
    request_id: req.request_id,
    error: message,
    stack: err.stack,
    status_code,
  });

  res.status(status_code).json({
    error: message,
    request_id: req.request_id,
  });
}
