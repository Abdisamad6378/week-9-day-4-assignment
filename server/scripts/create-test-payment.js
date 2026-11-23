// Creates (or resets to pending) a test payment, so a simulated callback has something to update.
// Usage: npm run test-payment -- [checkoutRequestId]     default: ws_CO_TEST_001
const prisma = require('../db');

const checkoutRequestId = process.argv[2] || 'ws_CO_TEST_001';

const fresh = {
  status: 'pending',
  amount: 100,
  phoneNumber: '254712345678',
  merchantRequestId: '29115-34620561-1',
  accountReference: 'PayLink',
  transactionDesc: 'Test payment',
  resultCode: null,
  resultDesc: null,
  mpesaReceiptNumber: null,
  transactionDate: null,
};

prisma.payment
  .upsert({ where: { checkoutRequestId }, update: fresh, create: { checkoutRequestId, ...fresh } })
  .then((payment) => console.log(`Pending test payment ready: ${payment.checkoutRequestId} (KES ${payment.amount})`))
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
