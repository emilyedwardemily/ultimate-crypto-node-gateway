require('dotenv').config({ path: __dirname + '/.env' });
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const bcrypt = require('bcryptjs'); 
const jwt = require('jsonwebtoken');
const axios = require('axios'); 
const morgan = require('morgan'); // IMEONGEZWA: Kwa ajili ya ku-monitor traffic ya biashara
const Selcom = require("selcom-apigw-client");
const app = express();

// --- 1. CONFIGURATION ---
// Imetayarishwa kwa ajili ya Render (Port 10000)
const PORT = process.env.PORT || 10000; 
const rawMongoURI = process.env.MONGO_URI; 

// A) Security Keys za Mfumo Wako (Internal)
const API_SECRET = process.env.API_SECRET_KEY || "Emily_Crypto_Secure_2026_KIU";
const JWT_SECRET = "Emily_Crypto_SaaS_Token_2026";

// B) Selcom API Credentials (External)
const selcomApiKey = process.env.SELCOM_API_KEY;
const selcomApiSecret = process.env.SELCOM_API_SECRET;
const selcomBaseUrl = "https://apigw.selcom.co.tz/home"; 

// Initialize Selcom Client (Bila mabano {} kwenye require ili kuepuka constructor error)

const selcomClient = new Selcom({
    baseUrl: selcomBaseUrl,
    apiKey: selcomApiKey,
    apiSecret: selcomApiSecret
});

// C) Link ya Backend ya Python
const PYTHON_BACKEND_URL = "https://ultimate-crypto-python.onrender.com";

if (!rawMongoURI) {
    console.error("\n❌ [FATAL ERROR] MONGO_URI is missing from your .env file!");
    process.exit(1);
}

// --- 2. MIDDLEWARES ---
app.use(helmet()); 
app.use(morgan('dev')); // IMEONGEZWA: Itakuonyesha kila "Login" au "Payment" inayofanyika kwenye logs
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
        if (userExists) return res.status(400).json({ status: "Fail", message: "User tayari yupo!" });

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
        res.status(201).json({ status: "Success", message: "Akaunti imetengenezwa vizuri!" });
    } catch (err) {
        console.error("Registration Error:", err);
        res.status(500).json({ status: "Error", message: "Server Error wakati wa kusajili." });
    }
});

// LOGIN (Boreshwa kwa ajili ya Commercial Standard)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const db = mongoose.connection.db;
        const user = await db.collection('users').findOne({ email });

        if (!user) {
            return res.status(404).json({ 
                status: "Fail", 
                message: "Akaunti haijapatikana. Tafadhali jisajili." 
            });
        }

        let isMatch = false;
        if (user.password.startsWith('$')) {
            isMatch = await bcrypt.compare(password, user.password);
        } else {
            isMatch = (password === user.password);
        }

        if (isMatch) {
            const token = jwt.sign(
                { userId: user._id, role: user.role }, 
                JWT_SECRET, 
                { expiresIn: '24h' }
            );

            console.log(`[AUTH] Successful login for: ${email}`);

            return res.status(200).json({
                status: "Success",
                message: "Karibu kwenye Ultimate Crypto Suite",
                token,
                user: { 
                    username: user.username, 
                    role: user.role,
                    lastLogin: new Date().toISOString()
                }
            });
        } else {
            return res.status(401).json({ 
                status: "Fail", 
                message: "Nenosiri siyo sahihi. Jaribu tena." 
            });
        }
    } catch (err) {
        console.error("Login Server Error:", err);
        res.status(500).json({ status: "Error", message: "Tatizo la kiufundi, jaribu baadae." });
    }
});

//// MPESA STK PUSH (Selcom Production Ready)
app.post('/api/payments/stkpush', async (req, res) => {
    const { phoneNumber, amount } = req.body;

    try {
        const walletCashinRequestJson = {
            "transid": "UC-" + Date.now(),
            "utilitycode": "VMCASHIN",
            "utilityref": phoneNumber,
            "amount": amount,
            "vendor": "64654949",
            "pin": "3545846",
            "msisdn": phoneNumber.startsWith('0') ? '255' + phoneNumber.substring(1) : phoneNumber
        };

        const response = await selcomClient.postFunc("/v1/wallet-cashin", walletCashinRequestJson);
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
    res.status(200).send("OK");
});

// SYNC ROUTE
app.post('/api/vault/sync', async (req, res) => {
    try {
        const { userId, service, encryptedData, type } = req.body;
        if (!userId || !encryptedData) return res.status(400).json({ status: "Error", message: "Missing Payload" });

        const entry = new Crypto({ userId, service, encryptedData, type });
        await entry.save();
        res.status(201).json({ status: "Success", message: "Data Secured in MongoDB Cloud" });
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
    console.log(`\n🚀 [SERVER] Professional Gateway Active on Port: ${PORT}`);
    console.log(`🔗 Python Link: ${PYTHON_BACKEND_URL}`);
    console.log(`📂 Database: MongoDB Atlas Ready\n`);
});