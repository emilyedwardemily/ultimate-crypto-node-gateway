// 1. Import package
const { apigwClient } = require("selcom-apigw-client");

// 2. Initialize Client na Credentials zako
// KUMBUKA: Kwenye Production, hizi apiKey na apiSecret ziweke kwenye Environment Variables kule Render
const apiKey = '202cb962ac59075b964b07152d234b70';
const apiSecret = '81dc9bdb52d04dc20036dbd8313ed055';

// Selcom Sandbox URL (Tumia hii kwa majaribio kabla ya kwenda Live)
const baseUrl = "https://apigw.selcom.co.tz/home"; 

const client = new apigwClient(baseUrl, apiKey, apiSecret);

// 3. Data ya Muamala (Wallet Cashin)
// Hakikisha transid inakuwa unique kila wakati (unatoa random string au timestamp)
const walletCashinRequestJson = {
    "transid": "UC-" + Date.now(), // Unique ID kwa kila transaction
    "utilitycode": "VMCASHIN",
    "utilityref": "0679871195",    // Namba ya mteja (Emily - mfano)
    "amount": 8000,
    "vendor": "64654949",
    "pin": "3545846",
    "msisdn": "255679871195"       // Format ya kimataifa (255...)
};

// 4. Path relative to base url
const walletCashinRequestPath = "/v1/wallet-cashin"; 

// 5. Create new walletCashinRequest
// Tunatumia async function hapa ili kupata response vizuri
async function processPayment() {
    try {
        console.log("[SELCOM] Inatuma ombi la malipo...");
        const response = await client.postFunc(walletCashinRequestPath, walletCashinRequestJson);
        
        // Hapa ndipo unapo-update MongoDB yako kuwa user amelipia
        console.log("[RESULT]", response);
        return response;
    } catch (error) {
        console.error("[ERROR]", error);
        throw error;
    }
}

// Ite function
processPayment();