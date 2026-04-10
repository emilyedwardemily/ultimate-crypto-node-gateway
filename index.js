require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const axios = require('axios'); 
const morgan = require('morgan');

// ✅ Selcom FIX (works for both default & non-default export)
const SelcomLib = require("selcom-apigw-client");
const Selcom = SelcomLib.default || SelcomLib;

const app = express();

// --- 1. CONFIGURATION ---
const PORT = process.env.PORT || 10000; 
const rawMongoURI = process.env.MONGO_URI; 

// Internal Security
const API_SECRET = process.env.API_SECRET_KEY || "Emily_Crypto_Secure_2026_KIU";
const JWT_SECRET = "Emily_Crypto_SaaS_Token_2026";

// Selcom Config
const selcomApiKey = process.env.SELCOM_API_KEY;
const selcomApiSecret = process.env.SELCOM_API_SECRET;
const selcomBaseUrl = "https://apigw.selcom.co.tz";

// ✅ Initialize Selcom correctly
const selcomClient = new Selcom({
    baseUrl: selcomBaseUrl,
    apiKey: selcomApiKey,
    apiSecret: selcomApiSecret
});

// Python backend
const PYTHON_BACKEND_URL = "https://ultimate-crypto-python.onrender.com";

// Check Mongo URI
if (!rawMongoURI) {
    console.error("❌ MONGO_URI missing in environment variables");
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
    console.log("✅ MongoDB Connected Successfully");
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
    const publicPaths = [
        '/api/auth/login',
        '/api/auth/register',
        '/status',
        '/api/payments/stkpush'
    ];

    if (publicPaths.includes(req.path)) return next();

    const key = req.header('x-api-key');
    if (!key || key !== API_SECRET) {
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
            user: { username: user.username, role: user.role }
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 💳 STK PUSH
app.post('/api/payments/stkpush', async (req, res) => {
    try {
        const { phoneNumber, amount } = req.body;

        const payload = {
            transid: "UC-" + Date.now(),
            utilitycode: "VMCASHIN",
            utilityref: phoneNumber,
            amount,
            vendor: "64654949",
            pin: "3545846",
            msisdn: phoneNumber.startsWith('0')
                ? '255' + phoneNumber.slice(1)
                : phoneNumber
        };

        const response = await selcomClient.postFunc("/v1/wallet-cashin", payload);

        res.json(response);

    } catch (err) {
        console.error("Selcom error:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// CALLBACK
app.post('/api/payments/callback', (req, res) => {
    res.send("OK");
});

// SYNC
app.post('/api/vault/sync', async (req, res) => {
    try {
        const { userId, service, encryptedData, type } = req.body;

        const data = new Crypto({ userId, service, encryptedData, type });
        await data.save();

        res.json({ message: "Saved" });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// FETCH
app.get('/api/vault/fetch/:userId', async (req, res) => {
    try {
        const data = await Crypto.find({ userId: req.params.userId });
        res.json(data);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// STATUS
app.get('/status', (req, res) => {
    res.json({
        status: "Online",
        db: mongoose.connection.readyState === 1
    });
});

// --- 7. START SERVER ---
// ✅ IMPORTANT FIX (Render)
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on port ${PORT}`);
});