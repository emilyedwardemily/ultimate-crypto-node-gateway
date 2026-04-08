//import package
const {apigwClient } = require("selcom-apigw-client");

// initalize a new Client instace with values of the base url, api key and api secret
const apiKey = '202cb962ac59075b964b07152d234b70';
const apiSecret = '81dc9bdb52d04dc20036dbd8313ed055';
const baseUrl = "http://example.com"

const client = new apigwClient (baseUrl, apiKey, apiSecret);

//data
var walletCahinRequestJson = {
    "transid":"1218d5Qb",
    "utilitycode": "VMCASHIN",
    "utilityref": "0149449499",
    "amount" : 8000,
    "vendor" : "64654949",
    "pin" :  "3545846",
    "msisdn" : "01854595959"
};
// path relatiive to base url
var walletCahinRequestPath = "/v1/walletcashin/process"

//crate new walletCahinRequest
var walletCahinRequestRespose = client.postFunc(walletCahinRequestPath, walletCahinRequestJson);
