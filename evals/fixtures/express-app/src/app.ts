import express from 'express';
import { notesRouter } from './routes/notes';

export function createApp() {
  const app = express();
  app.use(express.json());
  app.use(notesRouter);
  app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ code: 'INTERNAL_ERROR' });
  });
  return app;
}
