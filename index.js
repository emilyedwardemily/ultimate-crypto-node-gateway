require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const morgan = require('morgan');

const app = express();

// --- 1. CONFIGURATION ---
const PORT = process.env.PORT || 10000; 
const rawMongoURI = process.env.MONGO_URI; 

// Security
const API_SECRET = process.env.API_SECRET_KEY || "Emily_Crypto_Secure_2026_KIU";
const JWT_SECRET = "Emily_Crypto_SaaS_Token_2026";

// Python backend (optional)
const PYTHON_BACKEND_URL = "https://ultimate-crypto-python.onrender.com";

// Check Mongo
if (!rawMongoURI) {
    console.error("❌ MONGO_URI missing in environment variables!");
    process.exit(1);
}

// --- 2. MIDDLEWARES ---
app.use(helmet()); 
app.use(morgan('dev'));
app.use(express.json({ limit: '50mb' }));

app.use(cors({
    origin: "*", 
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization"]
}));

// --- 3. DATABASE ---
mongoose.connect(rawMongoURI)
.then(() => {
    console.log("✅ MongoDB Connected");
})
.catch(err => {
    console.error("❌ MongoDB Error:", err.message);
    process.exit(1); 
});

// --- 4. SCHEMA ---
const CryptoSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true }, 
    service: { type: String, default: "General" },
    encryptedData: { type: String, required: true },
    type: { type: String, default: "Vault" }, 
    date: { type: Date, default: Date.now }
});

const Crypto = mongoose.model('Crypto', CryptoSchema);

// --- 5. SECURITY ---
app.use((req, res, next) => {
    const publicPaths = ['/api/auth/login', '/api/auth/register', '/status'];
    
    if (publicPaths.includes(req.path)) return next();

    const key = req.header('x-api-key');
    if (!key || key !== API_SECRET) {
        console.warn(`🛑 Blocked request: ${req.path}`);
        return res.status(401).json({ message: "Invalid API Key" });
    }

    next();
});

// --- 6. ROUTES ---

// REGISTER
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;
        const db = mongoose.connection.db;

        const exists = await db.collection('users').findOne({ email });
        if (exists) return res.status(400).json({ message: "User exists" });

        const hash = await bcrypt.hash(password, 10);

        await db.collection('users').insertOne({
            username,
            email,
            password: hash,
            role: 'FREE',
            createdAt: new Date()
        });

        res.status(201).json({ message: "Registered successfully" });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = mongoose.connection.db;

        const user = await db.collection('users').findOne({ email });
        if (!user) return res.status(404).json({ message: "User not found" });

        const match = await bcrypt.compare(password, user.password);
        if (!match) return res.status(401).json({ message: "Wrong password" });

        const token = jwt.sign(
            { userId: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            token,
            user: {
                username: user.username,
                role: user.role
            }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// SYNC DATA
app.post('/api/vault/sync', async (req, res) => {
    try {
        const { userId, service, encryptedData, type } = req.body;

        if (!userId || !encryptedData) {
            return res.status(400).json({ message: "Missing data" });
        }

        const entry = new Crypto({ userId, service, encryptedData, type });
        await entry.save();

        res.json({ message: "Saved successfully" });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// FETCH DATA
app.get('/api/vault/fetch/:userId', async (req, res) => {
    try {
        const data = await Crypto.find({ userId: req.params.userId })
            .sort({ date: -1 })
            .limit(100);

        res.json(data);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// STATUS
app.get('/status', (req, res) => {
    res.json({
        status: "Online",
        db: mongoose.connection.readyState === 1,
        time: new Date().toISOString()
    });
});

// --- 7. START SERVER ---
// ✅ IMPORTANT (Render FIX)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});