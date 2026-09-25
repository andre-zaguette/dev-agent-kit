import type { NextFunction, Request, Response } from 'express';

export interface AuthedRequest extends Request {
  user: { id: number };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const id = Number(req.header('x-user-id'));
  if (!Number.isInteger(id) || id <= 0) return res.status(401).json({ code: 'UNAUTHENTICATED' });
  (req as AuthedRequest).user = { id };
  next();
}
