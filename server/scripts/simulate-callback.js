// Sends a fake Safaricom callback to the running server, so you can test without a real payment.
// Usage: npm run simulate -- <checkoutRequestId> [success|cancelled|failed]
//   npm run simulate -- ws_CO_TEST_001 success
//   npm run simulate -- ws_CO_TEST_001 cancelled
require('dotenv').config({ quiet: true });
const axios = require('axios');

const [checkoutRequestId = 'ws_CO_TEST_001', outcome = 'success'] = process.argv.slice(2);
const url = `http://localhost:${process.env.PORT || 3000}/api/mpesa/callback`;

const results = {
  success: { ResultCode: 0, ResultDesc: 'The service request is processed successfully.' },
  cancelled: { ResultCode: 1032, ResultDesc: 'Request cancelled by user.' },
  failed: { ResultCode: 1, ResultDesc: 'The balance is insufficient for the transaction.' },
};

if (!results[outcome]) {
  console.error(`Unknown outcome "${outcome}". Use success, cancelled or failed.`);
  process.exit(1);
}

const stkCallback = {
  MerchantRequestID: '29115-34620561-1',
  CheckoutRequestID: checkoutRequestId,
  ...results[outcome],
};

// Only successful payments come with CallbackMetadata.
if (outcome === 'success') {
  stkCallback.CallbackMetadata = {
    Item: [
      { Name: 'Amount', Value: 100 },
      { Name: 'MpesaReceiptNumber', Value: 'SHK4G7Y8DR' },
      { Name: 'TransactionDate', Value: 20260504143055 },
      { Name: 'PhoneNumber', Value: 254712345678 },
    ],
  };
}

axios
  .post(url, { Body: { stkCallback } })
  .then((response) => console.log(`${outcome} callback sent for ${checkoutRequestId} -> ${response.status}`, response.data))
  .catch((error) => {
    console.error(`Could not send callback to ${url}: ${error.message}. Is the server running?`);
    process.exitCode = 1;
  });
