"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// POST /api/analytics/events — fire-and-forget, auth optional
router.post('/events', async (req, res) => {
    const { event_name, event_category, properties, page, session_id } = req.body;
    if (!event_name) {
        res.status(400).json({ error: 'event_name required' });
        return;
    }
    let userId = null;
    const authHeader = req.headers.authorization?.split(' ')[1];
    if (authHeader) {
        try {
            const jwt = await Promise.resolve().then(() => __importStar(require('jsonwebtoken')));
            const payload = jwt.default.verify(authHeader, process.env.JWT_SECRET);
            userId = payload.id;
        }
        catch { /* unauthenticated event is fine */ }
    }
    try {
        await db_1.pool.query(`INSERT INTO analytics_events (event_name, event_category, properties, page, session_id, user_id)
       VALUES ($1, $2, $3, $4, $5, $6)`, [event_name, event_category || 'other', JSON.stringify(properties || {}), page, session_id, userId]);
        res.json({ ok: true });
    }
    catch (err) {
        console.error('Analytics insert error:', err);
        res.status(500).json({ error: 'Failed to record event' });
    }
});
// GET /api/analytics/events — admin only
router.get('/events', auth_1.requireAuth, async (req, res) => {
    if (req.user.role !== 'admin') {
        res.status(403).json({ error: 'Forbidden' });
        return;
    }
    try {
        const limit = Math.min(Number(req.query.limit) || 100, 500);
        const { rows } = await db_1.pool.query('SELECT * FROM analytics_events ORDER BY created_at DESC LIMIT $1', [limit]);
        res.json(rows);
    }
    catch (err) {
        console.error('Get analytics error:', err);
        res.status(500).json({ error: 'Failed to get analytics' });
    }
});
exports.default = router;
