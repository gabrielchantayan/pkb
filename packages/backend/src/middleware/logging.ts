import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger.js';

declare global {
  namespace Express {
    interface Request {
      request_id: string;
    }
  }
}

export function logging_middleware(req: Request, res: Response, next: NextFunction): void {
  const request_id = randomUUID();
  req.request_id = request_id;

  const start = Date.now();

  res.on('finish', () => {
    const duration_ms = Date.now() - start;
    logger.info('request completed', {
      request_id,
      method: req.method,
      path: req.path,
      status: res.statusCode,
      duration_ms,
    });
  });

  next();
}
