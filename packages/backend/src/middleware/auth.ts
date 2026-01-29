import { Request, Response, NextFunction } from 'express';
import { config } from '../config.js';

export function api_key_auth(req: Request, res: Response, next: NextFunction): void {
  if (!config.api_key) {
    next();
    return;
  }

  const provided_key = req.headers['x-api-key'];

  if (provided_key !== config.api_key) {
    res.status(401).json({ error: 'Invalid API key' });
    return;
  }

  next();
}

export function session_auth(_req: Request, _res: Response, next: NextFunction): void {
  // TODO: Implement session/JWT authentication
  next();
}
