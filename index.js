require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const axios = require('axios'); 
const apigwClient = require("selcom-apigw-client");

const app = express();

// --- 1. CONFIGURATION ---
// Imetayarishwa kwa ajili ya Render (Port 10000)
const PORT = process.env.PORT || 10000; 
const rawMongoURI = process.env.MONGO_URI; 

// A) Security Keys za Mfumo Wako (Internal)
const API_SECRET = process.env.API_SECRET_KEY || "Emily_Crypto_Secure_2026_KIU";
const JWT_SECRET = "Emily_Crypto_SaaS_Token_2026";

// B) Selcom API Credentials (External)
// Hizi zitasomwa kutoka kwenye Environment Variables uliyoandika kule Render
const selcomApiKey = process.env.SELCOM_API_KEY;
const selcomApiSecret = process.env.SELCOM_API_SECRET;
const selcomBaseUrl = "https://apigw.selcom.co.tz/home"; 

// Initialize Selcom Client hapa hapa
const selcomClient = new apigwClient(selcomBaseUrl, selcomApiKey, selcomApiSecret);

// C) Link ya Backend ya Python
const PYTHON_BACKEND_URL = "https://ultimate-crypto-python.onrender.com";

if (!rawMongoURI) {
    console.error("\n❌ [FATAL ERROR] MONGO_URI is missing from your .env file!");
    process.exit(1);
}

// --- 2. MIDDLEWARES ---
app.use(helmet()); 
app.use(express.json({ limit: '50mb' })); 

// Imeruhusiwa sasa kuongea na Backend ya Python na Browser
app.use(cors({
    origin: "*", 
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "x-api-key", "Authorization"]
}));

// --- 3. DATABASE CONNECTION ---
mongoose.connect(rawMongoURI)
.then(() => {
    console.log("------------------------------------------");
    console.log("✅ [DATABASE] Cloud Vault: ESTABLISHED");
    console.log("🌐 Connected to: MongoDB Atlas Cluster");
    console.log("------------------------------------------");
})
.catch(err => {
    console.error("\n❌ [DATABASE] Critical Connection Failure!");
    console.error(`Sababu: ${err.message}`);
    process.exit(1); 
});

// --- 4. SCHEMA DEFINITION ---
const CryptoSchema = new mongoose.Schema({
    userId: { type: String, required: true, index: true }, 
    service: { type: String, default: "General" },
    encryptedData: { type: String, required: true },
    type: { type: String, default: "Vault" }, 
    date: { type: Date, default: Date.now }
});
const Crypto = mongoose.model('Crypto', CryptoSchema);

// --- 5. SECURITY MIDDLEWARE ---
app.use((req, res, next) => {
    const publicPaths = ['/api/auth/login', '/api/auth/register', '/status', '/api/payments/stkpush'];
    if (publicPaths.includes(req.path)) {
        return next();
    }

    const userApiKey = req.header('x-api-key') || req.header('X-API-KEY');
    if (!userApiKey || userApiKey !== API_SECRET) {
        console.warn(`🛑 [BLOCKED] Unauthorized access from IP: ${req.ip} to ${req.path}`);
        return res.status(401).json({ status: "Error", message: "Access Denied: Invalid API Key" });
    }
    next(); 
});

// --- 6. ROUTES ---

// REGISTER
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, username } = req.body;
        const db = mongoose.connection.db;
        const userExists = await db.collection('users').findOne({ email });
        if (userExists) return res.status(400).json({ error: "User tayari yupo!" });

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        const newUser = {
            username,
            email,
            password: hashedPassword, 
            role: 'FREE',
            createdAt: new Date()
        };

        await db.collection('users').insertOne(newUser);
        console.log(`[SECURE] New user registered: ${username}`);
        res.status(201).json({ message: "Akaunti imetengenezwa vizuri!" });
    } catch (err) {
        console.error("Registration Error:", err);
        res.status(500).json({ error: "Server Error wakati wa kusajili." });
    }
});

// LOGIN
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = mongoose.connection.db;
        const user = await db.collection('users').findOne({ email });

        if (!user) return res.status(400).json({ error: "Email haijapatikana!" });

        let isMatch = false;
        if (user.password.startsWith('$')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            isMatch = (password === user.password);
        }

        if (isMatch) {
            const token = jwt.sign({ userId: user._id, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
            return res.json({
                message: "Login Successful",
                token,
                user: { username: user.username, role: user.role }
            });
        } else {
            return res.status(400).json({ error: "Password siyo sahihi!" });
        }
    } catch (err) {
        res.status(500).json({ error: "Server Error wakati wa login." });
    }
});

//// MPESA STK PUSH (Updated for Selcom Production)
app.post('/api/payments/stkpush', async (req, res) => {
    const { phoneNumber, amount } = req.body;

    try {
        const walletCashinRequestJson = {
            "transid": "UC-" + Date.now(), // Unique ID kila wakati
            "utilitycode": "VMCASHIN",
            "utilityref": phoneNumber,      // Namba ya mteja (iliyotumwa kutoka Java)
            "amount": amount,
            "vendor": "64654949",          // Badilisha na Vendor ID yako ukipata
            "pin": "3545846",              // Hii ni placeholder
            "msisdn": phoneNumber.startsWith('0') ? '255' + phoneNumber.substring(1) : phoneNumber
        };

        const walletCashinRequestPath = "/v1/wallet-cashin";

        // Tuma ombi Selcom
        const response = await selcomClient.postFunc(walletCashinRequestPath, walletCashinRequestJson);

        console.log(`✅ [SELCOM] Payment Request Sent for ${phoneNumber}`);
        res.status(200).json(response);

    } catch (error) {
        console.error("❌ [SELCOM ERROR]", error);
        res.status(500).json({ 
            status: "Error", 
            message: "Selcom Gateway Failure",
            details: error.message 
        });
    }
});

// MPESA CALLBACK
app.post('/api/payments/callback', (req, res) => {
    const callbackData = req.body;
    if (callbackData.resultcode === "000" || callbackData.status === "SUCCESS") {
        res.status(200).send("OK");
    } else {
        res.status(200).send("OK");
    }
});

// SYNC ROUTE (Unganisha na Python hapa ukitaka)
app.post('/api/vault/sync', async (req, res) => {
    try {
        const { userId, service, encryptedData, type } = req.body;
        if (!userId || !encryptedData) return res.status(400).json({ status: "Error", message: "Missing Payload" });

        const entry = new Crypto({ userId, service, encryptedData, type });
        await entry.save();
        res.status(201).json({ status: "success", message: "Data Secured in MongoDB Cloud" });
    } catch (error) {
        res.status(500).json({ status: "Error", message: "Internal Sync Failure" });
    }
});

// FETCH ROUTE
app.get('/api/vault/fetch/:userId', async (req, res) => {
    try {
        const records = await Crypto.find({ userId: req.params.userId }).sort({ date: -1 }).limit(100);
        res.status(200).json(records);
    } catch (error) {
        res.status(500).json({ status: "Error", message: "Data Retrieval Failed" });
    }
});

// HEALTH CHECK
app.get('/status', (req, res) => {
    res.send({ 
        status: "Online", 
        db_connected: mongoose.connection.readyState === 1,
        python_backend: PYTHON_BACKEND_URL,
        server_time: new Date().toISOString()
    });
});

// --- 7. START SERVER ---
app.listen(PORT, () => {
    console.log(`\n🚀 [SERVER] Gateway Active on Port: ${PORT}`);
    console.log(`🔗 Python Link: ${PYTHON_BACKEND_URL}`);
    console.log(`📂 Database: MongoDB Atlas Ready\n`);
});