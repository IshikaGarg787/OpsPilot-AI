import express, { type RequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import authRoutes from './routes/authRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import userRoutes from './routes/userRoutes.js';
import modelRoutes from './routes/modelRoutes.js';
import predictionRoutes from './routes/predictionRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import capacityRoutes from './routes/capacityRoutes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';

const app = express();

app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: (origin, callback) => { if (!origin || env.clientOrigins.includes(origin)) callback(null, true); else callback(new Error('Origin is not allowed.')); }, credentials: true }));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false });
app.use('/api/v1', apiLimiter);

const originGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.headers.origin || env.clientOrigins.includes(req.headers.origin)) next();
  else next(new Error('Origin is not allowed.'));
};
app.use(originGuard);

app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/models', modelRoutes);
app.use('/api/v1/predictions', predictionRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/capacity-plans', capacityRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
