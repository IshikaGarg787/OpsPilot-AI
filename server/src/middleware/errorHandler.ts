import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

export class HttpError extends Error {
  constructor(public status: number, message: string, public code = 'REQUEST_ERROR') {
    super(message);
  }
}

export const asyncHandler = (handler: RequestHandler): RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

export const notFound: RequestHandler = (_req, _res, next) => next(new HttpError(404, 'Route not found', 'NOT_FOUND'));

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) {
    res.status(400).json({
      success: false,
      message: 'Please check the highlighted fields.',
      code: 'VALIDATION_ERROR',
      details: error.issues.map((issue) => ({ path: issue.path, message: issue.message })),
    });
    return;
  }
  const status = error instanceof HttpError ? error.status : 500;
  const message = error instanceof HttpError ? error.message : 'An unexpected server error occurred.';
  if (error instanceof HttpError) console.error(`[${error.code}] ${error.message}`);
  else console.error(error);
  res.status(status).json({ success: false, message, code: error instanceof HttpError ? error.code : 'INTERNAL_ERROR' });
};
