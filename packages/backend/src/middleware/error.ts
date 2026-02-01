import { Request, Response, NextFunction } from 'express';
import { logger } from '../lib/logger.js';

export interface ApiError extends Error {
  status_code?: number;
  status?: number; // body-parser uses 'status'
}

export function error_middleware(
  err: ApiError,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  const status_code = err.status_code || err.status || 500;
  const message = err.message || 'Internal server error';

  const log_context: Record<string, unknown> = {
    request_id: req.request_id,
    method: req.method,
    path: req.originalUrl || req.path,
    error: message,
    error_type: err.name,
    status_code,
  };

  // For payload errors, include size info
  if (err.name === 'PayloadTooLargeError' || status_code === 413) {
    log_context.content_length = req.headers['content-length'];
    log_context.content_type = req.headers['content-type'];
  }

  // Only include stack in non-production or for 500 errors
  if (status_code >= 500) {
    log_context.stack = err.stack;
  }

  logger.error('request error', log_context);

  res.status(status_code).json({
    error: message,
    request_id: req.request_id,
  });
}
