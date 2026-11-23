// Sends a fake Safaricom callback to the running server, so you can test without a real payment.
// Usage: npm run simulate -- <checkoutRequestId> [success|cancelled|failed]
//   npm run simulate -- ws_CO_TEST_001 success
//   npm run simulate -- ws_CO_TEST_001 cancelled
require('dotenv').config({ quiet: true });
const axios = require('axios');

const [checkoutRequestId = 'ws_CO_TEST_001', outcome = 'success'] = process.argv.slice(2);
const baseUrl = `http://localhost:${process.env.PORT || 3000}`;
const url = `${baseUrl}/api/mpesa/callback`;

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

// A receipt number that looks like M-Pesa's: 10 capital letters and digits.
const randomReceipt = () =>
  Array.from({ length: 10 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789'[Math.floor(Math.random() * 34)]).join('');

// YYYYMMDDHHmmss as a number, like Safaricom sends it.
const now = new Date();
const transactionDate = Number(
  [now.getFullYear(), now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part, i) => String(part).padStart(i === 0 ? 4 : 2, '0'))
    .join(''),
);

async function main() {
  // Only successful payments come with CallbackMetadata. Use the payment's real amount and
  // phone (from the running server) so the receipt in the React app matches what was typed.
  if (outcome === 'success') {
    let payment = { amount: 100, phoneNumber: '254712345678' };
    try {
      payment = (await axios.get(`${baseUrl}/api/payments/${checkoutRequestId}`)).data.data;
    } catch {
      console.warn(`Payment ${checkoutRequestId} not found on the server, using KES 100 and 254712345678.`);
    }
    stkCallback.CallbackMetadata = {
      Item: [
        { Name: 'Amount', Value: payment.amount },
        { Name: 'MpesaReceiptNumber', Value: randomReceipt() },
        { Name: 'TransactionDate', Value: transactionDate },
        { Name: 'PhoneNumber', Value: Number(payment.phoneNumber) },
      ],
    };
  }

  const response = await axios.post(url, { Body: { stkCallback } });
  console.log(`${outcome} callback sent for ${checkoutRequestId} -> ${response.status}`, response.data);
}

main()
  .catch((error) => {
    console.error(`Could not send callback to ${url}: ${error.message}. Is the server running?`);
    process.exitCode = 1;
  });
