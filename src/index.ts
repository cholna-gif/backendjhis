import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { createServer } from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';

import { pool } from './db';
import authRoutes from './routes/auth';
import profileRoutes from './routes/profile';
import ridesRoutes from './routes/rides';
import driverRoutes from './routes/driver';
import notificationsRoutes from './routes/notifications';
import analyticsRoutes from './routes/analytics';
import waitlistRoutes from './routes/waitlist';
import adminRoutes from './routes/admin';
import cmsRoutes from './routes/cms';

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
  'http://localhost:8080',
  'http://localhost:5173',
  'http://localhost:3000',
  ...((process.env.FRONTEND_URL || '').split(',').filter(Boolean)),
];

const corsOptions = {
  origin: (origin: string | undefined, cb: (e: Error | null, ok?: boolean) => void) => {
    // Allow requests with no origin (curl, mobile apps) and all listed origins
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error(`CORS blocked: ${origin}`));
  },
  credentials: true,
};

const io = new Server(httpServer, {
  cors: { origin: allowedOrigins, credentials: true },
});

app.use(cors(corsOptions));
app.use(express.json({ limit: '10mb' }));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/rides', ridesRoutes);
app.use('/api/driver', driverRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/cms', cmsRoutes);

app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Socket.io — realtime ride tracking and chat
io.use((socket, next) => {
  const token = socket.handshake.auth?.token;
  if (!token) return next(new Error('Unauthorized'));
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET!) as { id: string; role: string };
    (socket as any).user = payload;
    next();
  } catch {
    next(new Error('Invalid token'));
  }
});

io.on('connection', (socket) => {
  const user = (socket as any).user as { id: string; role: string };

  // Passenger/driver joins a ride room
  socket.on('join-ride', (rideId: string) => {
    socket.join(`ride:${rideId}`);
  });

  socket.on('leave-ride', (rideId: string) => {
    socket.leave(`ride:${rideId}`);
  });

  // Driver broadcasts location update
  socket.on('location-update', async ({ rideId, lat, lng }: { rideId: string; lat: number; lng: number }) => {
    if (user.role !== 'driver') return;
    try {
      await pool.query(
        'UPDATE driver_profiles SET current_lat = $1, current_lng = $2, last_location_update = NOW() WHERE user_id = $3',
        [lat, lng, user.id]
      );
    } catch { /* non-critical */ }
    io.to(`ride:${rideId}`).emit('driver-location', { lat, lng, driverId: user.id });
  });

  // Ride status change broadcast
  socket.on('ride-status', ({ rideId, status }: { rideId: string; status: string }) => {
    io.to(`ride:${rideId}`).emit('ride-status', { rideId, status });
  });

  // Chat message
  socket.on('chat-message', ({ rideId, message }: { rideId: string; message: string }) => {
    io.to(`ride:${rideId}`).emit('chat-message', {
      rideId,
      message,
      senderId: user.id,
      senderRole: user.role,
      ts: new Date().toISOString(),
    });
  });

  // Driver comes online/offline
  socket.on('driver-online', async ({ lat, lng }: { lat: number; lng: number }) => {
    if (user.role !== 'driver') return;
    await pool.query(
      `UPDATE driver_profiles SET is_online = true, current_lat = $1, current_lng = $2, last_location_update = NOW()
       WHERE user_id = $3`,
      [lat, lng, user.id]
    ).catch(() => {});
    io.emit('driver-location-broadcast', { driverId: user.id, lat, lng, online: true });
  });

  socket.on('driver-offline', async () => {
    if (user.role !== 'driver') return;
    await pool.query(
      'UPDATE driver_profiles SET is_online = false WHERE user_id = $1',
      [user.id]
    ).catch(() => {});
  });

  socket.on('disconnect', () => {
    if (user.role === 'driver') {
      pool.query('UPDATE driver_profiles SET is_online = false WHERE user_id = $1', [user.id]).catch(() => {});
    }
  });
});

const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
  console.log(`JihWorld server running on http://localhost:${PORT}`);
});
