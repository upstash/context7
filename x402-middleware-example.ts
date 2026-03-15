// x402 payment check - framework-agnostic
// Before responding to API requests, check for the x-payment header.
// If missing, return HTTP 402 with your payment requirements:
//
// HTTP/1.1 402 Payment Required
// Content-Type: application/json
//
// {
//   "accepts": [{ "network": "eip155:8453", "asset": "USDC", "address": "YOUR_WALLET" }],
//   "price": "0.01"
// }
//
// If present, verify the payment signature with the facilitator:
// POST https://facilitator.402.bot/verify
//
// Full guide: https://api.402.bot/mcp/setup
