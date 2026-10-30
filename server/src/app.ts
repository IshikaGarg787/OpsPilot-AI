import express, { type RequestHandler } from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { env } from './config/env.js';
import authRoutes from './routes/authRoutes.js';
import userRoutes from './routes/userRoutes.js';
import modelRoutes from './routes/modelRoutes.js';
import predictionRoutes from './routes/predictionRoutes.js';
import dashboardRoutes from './routes/dashboardRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import ticketRoutes from './routes/ticketRoutes.js';
import capacityRoutes from './routes/capacityRoutes.js';
import adminRoutes from './routes/adminRoutes.js';
import slaRoutes from './routes/slaRoutes.js';
import supportChatRoutes from './routes/supportChatRoutes.js';
import { errorHandler, notFound } from './middleware/errorHandler.js';
import { loadShedder } from './middleware/loadShedder.js';

const app = express();

app.disable('x-powered-by');
// Production traffic reaches this service through Render's single load-balancer hop.
if (env.nodeEnv === 'production') app.set('trust proxy', 1);
app.use(helmet());
app.use(cors({ origin: (origin, callback) => { if (!origin || env.clientOrigins.includes(origin)) callback(null, true); else callback(new Error('Origin is not allowed.')); }, credentials: true }));
app.use('/api/v1', loadShedder);
const apiLimiter = rateLimit({
  windowMs: env.apiRateLimitWindowMs,
  limit: env.apiRateLimitMax,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: (req) => req.originalUrl.startsWith('/api/v1/health') || req.method === 'OPTIONS',
});
app.use('/api/v1', apiLimiter);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

const originGuard: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.headers.origin || env.clientOrigins.includes(req.headers.origin)) next();
  else next(new Error('Origin is not allowed.'));
};
app.use(originGuard);

app.use('/api/v1/health', healthRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/users', userRoutes);
app.use('/api/v1/models', modelRoutes);
app.use('/api/v1/predictions', predictionRoutes);
app.use('/api/v1/dashboard', dashboardRoutes);
app.use('/api/v1/tickets', ticketRoutes);
app.use('/api/v1/capacity-plans', capacityRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/sla', slaRoutes);
app.use('/api/v1/support-chat', supportChatRoutes);
app.use(notFound);
app.use(errorHandler);

export default app;
