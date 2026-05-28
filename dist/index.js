"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const http_1 = require("http");
const socket_io_1 = require("socket.io");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const db_1 = require("./db");
const socket_1 = require("./socket");
const auth_1 = __importDefault(require("./routes/auth"));
const profile_1 = __importDefault(require("./routes/profile"));
const rides_1 = __importDefault(require("./routes/rides"));
const driver_1 = __importDefault(require("./routes/driver"));
const notifications_1 = __importDefault(require("./routes/notifications"));
const analytics_1 = __importDefault(require("./routes/analytics"));
const waitlist_1 = __importDefault(require("./routes/waitlist"));
const admin_1 = __importDefault(require("./routes/admin"));
const cms_1 = __importDefault(require("./routes/cms"));
const db_2 = __importDefault(require("./routes/db"));
const rpc_1 = __importDefault(require("./routes/rpc"));
const passenger_1 = __importDefault(require("./routes/passenger"));
const app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(app);
const allowedOrigins = [
    'http://localhost:8080',
    'http://localhost:8081',
    'http://localhost:5173',
    'http://localhost:3000',
    ...((process.env.FRONTEND_URL || '').split(',').filter(Boolean)),
];
const corsOptions = {
    origin: (origin, cb) => {
        // Allow requests with no origin (curl, mobile apps) and all listed origins
        if (!origin || allowedOrigins.includes(origin))
            return cb(null, true);
        cb(new Error(`CORS blocked: ${origin}`));
    },
    credentials: true,
};
const io = new socket_io_1.Server(httpServer, {
    cors: { origin: allowedOrigins, credentials: true },
});
(0, socket_1.setIo)(io);
app.use((0, cors_1.default)(corsOptions));
app.use(express_1.default.json({ limit: '10mb' }));
app.use('/uploads', express_1.default.static(path_1.default.join(__dirname, '../uploads')));
// Routes
app.use('/api/auth', auth_1.default);
app.use('/api/profile', profile_1.default);
app.use('/api/rides', rides_1.default);
app.use('/api/driver', driver_1.default);
app.use('/api/notifications', notifications_1.default);
app.use('/api/analytics', analytics_1.default);
app.use('/api/waitlist', waitlist_1.default);
app.use('/api/admin', admin_1.default);
app.use('/api/cms', cms_1.default);
app.use('/api/db', db_2.default);
app.use('/api/rpc', rpc_1.default);
app.use('/api', passenger_1.default);
app.get('/api/health', (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));
// Socket.io — realtime ride tracking and chat
io.use((socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token)
        return next(new Error('Unauthorized'));
    try {
        const payload = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        socket.user = payload;
        next();
    }
    catch {
        next(new Error('Invalid token'));
    }
});
io.on('connection', (socket) => {
    const user = socket.user;
    // Passenger/driver joins a ride room
    socket.on('join-ride', (rideId) => {
        socket.join(`ride:${rideId}`);
    });
    socket.on('leave-ride', (rideId) => {
        socket.leave(`ride:${rideId}`);
    });
    // Driver broadcasts location update
    socket.on('location-update', async ({ rideId, lat, lng }) => {
        if (user.role !== 'driver')
            return;
        try {
            await db_1.pool.query('UPDATE driver_profiles SET current_lat = $1, current_lng = $2, last_location_update = NOW() WHERE user_id = $3', [lat, lng, user.id]);
        }
        catch { /* non-critical */ }
        io.to(`ride:${rideId}`).emit('driver-location', { lat, lng, driverId: user.id });
    });
    // Ride status change broadcast
    socket.on('ride-status', ({ rideId, status }) => {
        io.to(`ride:${rideId}`).emit('ride-status', { rideId, status });
    });
    // Chat message
    socket.on('chat-message', ({ rideId, message }) => {
        io.to(`ride:${rideId}`).emit('chat-message', {
            rideId,
            message,
            senderId: user.id,
            senderRole: user.role,
            ts: new Date().toISOString(),
        });
    });
    // Driver comes online/offline
    socket.on('driver-online', async ({ lat, lng }) => {
        if (user.role !== 'driver')
            return;
        await db_1.pool.query(`UPDATE driver_profiles SET is_online = true, current_lat = $1, current_lng = $2, last_location_update = NOW()
       WHERE user_id = $3`, [lat, lng, user.id]).catch(() => { });
        io.emit('driver-location-broadcast', { driverId: user.id, lat, lng, online: true });
    });
    socket.on('driver-offline', async () => {
        if (user.role !== 'driver')
            return;
        await db_1.pool.query('UPDATE driver_profiles SET is_online = false WHERE user_id = $1', [user.id]).catch(() => { });
    });
    socket.on('disconnect', () => {
        if (user.role === 'driver') {
            db_1.pool.query('UPDATE driver_profiles SET is_online = false WHERE user_id = $1', [user.id]).catch(() => { });
        }
    });
});
const PORT = Number(process.env.PORT) || 3000;
httpServer.listen(PORT, () => {
    console.log(`JihWorld server running on http://localhost:${PORT}`);
});
