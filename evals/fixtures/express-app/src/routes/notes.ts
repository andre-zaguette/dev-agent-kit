import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { notes } from '../services/notes';

export const notesRouter = Router();

notesRouter.get('/notes', requireAuth, async (req, res, next) => {
  try {
    res.json(await notes.listOwned((req as AuthedRequest).user.id));
  } catch (error) {
    next(error);
  }
});
