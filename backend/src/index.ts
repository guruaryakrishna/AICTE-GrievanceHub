import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import dotenv from 'dotenv';
import { createServer } from 'http';
import authRoutes from './routes/auth';
import institutionRoutes from './routes/institutions';
import caseRoutes from './routes/cases';
import alertRoutes from './routes/alerts';
import dashboardRoutes from './routes/dashboard';
import notificationRoutes from './routes/notifications';
import reportRoutes from './routes/reports';
import adminRoutes from './routes/admin';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { rateLimit, securityHeaders } from './middleware/security';
import { startSlaScheduler } from './services/slaService';

dotenv.config();

export const app = express();
export const httpServer = createServer(app);

const allowedOrigins = (process.env.FRONTEND_URL || 'http://localhost:5173')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

// Required behind a reverse proxy so rate limiting sees the real client IP.
app.set('trust proxy', 1);

app.use(securityHeaders);
app.use(
  cors({
    origin(origin, callback) {
      // Same-origin requests and non-browser clients do not send Origin.
      // Disallowed origins receive no CORS headers; state-changing requests are
      // additionally rejected by originGuard with a structured 403.
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Accept'],
  }),
);
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());
app.use('/api', rateLimit({ windowMs: 60_000, max: 600, keyPrefix: 'api' }));

app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'aicte-complaint-backend',
    database: 'sqlite (demonstration)',
    realtime: 'authenticated http refresh',
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/institutions', institutionRoutes);
app.use('/api/cases', caseRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/admin', adminRoutes);

app.use(notFoundHandler);
app.use(errorHandler);

const PORT = process.env.PORT || 5000;

if (process.env.NODE_ENV !== 'test') {
  httpServer.listen(PORT, () => {
    console.log(`AICTE Complaint Backend running on port ${PORT}`);
    startSlaScheduler();
  });
}
