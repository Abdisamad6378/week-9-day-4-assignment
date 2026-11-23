require('dotenv').config({ quiet: true });

const express = require('express');
const cors = require('cors');
const prisma = require('./db');
const { validateConfig } = require('./config');
const { initiateSTKPush, querySTKPushStatus, validateAmount } = require('./mpesa');
const { formatPhoneNumber } = require('./phone');
const {
  RESOLVED_STATUSES,
  statusFromResultCode,
  updateIfPending,
  processCallback,
  toPaymentResult,
} = require('./payments');

const app = express();
app.use(cors());
app.use(express.json());

const MAX_ACCOUNT_REFERENCE = 12;
const MAX_TRANSACTION_DESC = 13;
const STILL_PROCESSING = 'Payment is still being processed. Try again in a few seconds.';

// Day 4 polling: the React app calls GET /api/payments/:id/poll every 3 seconds.
// Normally the callback resolves the payment. If no callback has come (for example the
// callback URL is not reachable from Safaricom), the poll route asks Daraja itself, but
// not on every poll: Daraja rate-limits the query API.
const DARAJA_CHECK_AFTER_MS = 15 * 1000; // give the callback 15 seconds first
const DARAJA_CHECK_EVERY_MS = 10 * 1000; // then at most one Daraja query per 10 seconds per payment
const lastDarajaCheck = new Map(); // checkoutRequestId -> time of the last query (ms)

const badRequest = (res, error) => res.status(400).json({ success: false, error });

app.get('/', (req, res) => {
  res.json({
    message: 'Week 9 Day 4: Payment form API',
    endpoints: [
      'GET  /api/health',
      'POST /api/mpesa/stkpush',
      'POST /api/mpesa/callback',
      'POST /api/mpesa/query',
      'GET  /api/payments',
      'GET  /api/payments/:checkoutRequestId',
      'GET  /api/payments/:id/poll',
    ],
  });
});

app.get('/api/health', async (req, res) => {
  try {
    const config = validateConfig();
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      mpesa_configured: true,
      database: 'connected',
      environment: config.environment,
      shortcode: config.shortcode,
      callback_url: config.callbackUrl,
    });
  } catch (error) {
    res.status(500).json({ status: 'error', error: error.message });
  }
});

// From Day 2, now saving to the database instead of an array.
app.post('/api/mpesa/stkpush', async (req, res) => {
  const { phoneNumber, amount, accountReference = 'PayLink', transactionDesc = 'Payment' } = req.body || {};

  const phone = formatPhoneNumber(phoneNumber);
  if (!phone.success) return badRequest(res, phone.error);

  let validAmount;
  try {
    validAmount = validateAmount(amount);
  } catch (error) {
    return badRequest(res, error.message);
  }

  if (String(accountReference).length > MAX_ACCOUNT_REFERENCE) {
    return badRequest(res, `accountReference must be at most ${MAX_ACCOUNT_REFERENCE} characters.`);
  }
  if (String(transactionDesc).length > MAX_TRANSACTION_DESC) {
    return badRequest(res, `transactionDesc must be at most ${MAX_TRANSACTION_DESC} characters.`);
  }

  try {
    const daraja = await initiateSTKPush(phone.formatted, validAmount, accountReference, transactionDesc);

    if (daraja.ResponseCode !== '0') {
      return res.status(502).json({
        success: false,
        error: daraja.ResponseDescription || 'Safaricom did not accept the STK Push request.',
      });
    }

    const payment = await prisma.payment.create({
      data: {
        checkoutRequestId: daraja.CheckoutRequestID,
        merchantRequestId: daraja.MerchantRequestID,
        phoneNumber: phone.formatted,
        amount: validAmount,
        accountReference,
        transactionDesc,
      },
    });
    console.log(`Payment ${payment.checkoutRequestId} pending: KES ${validAmount} from ${phone.formatted}`);

    res.json({
      success: true,
      message: 'STK Push sent. Check your phone for the M-Pesa prompt.',
      data: { paymentId: payment.id, checkoutRequestId: payment.checkoutRequestId },
    });
  } catch (error) {
    console.error(`STK Push error: ${error.message}`);
    res.status(error.statusCode || 500).json({ success: false, error: error.message });
  }
});

// Task 1: Safaricom posts the payment result here.
app.post('/api/mpesa/callback', (req, res) => {
  // Answer 200 straight away. If Safaricom does not get it, it sends the callback again.
  res.status(200).json({ ResultCode: 0, ResultDesc: 'Accepted' });

  // Then process. Errors are only logged: the response has already gone.
  processCallback(req.body).catch((error) => {
    console.error(`Callback processing error: ${error.message}`);
  });
});

// Task 3: check a payment's status, from the database first, then from Daraja.
app.post('/api/mpesa/query', async (req, res) => {
  const { checkoutRequestId } = req.body || {};
  if (!checkoutRequestId || typeof checkoutRequestId !== 'string') {
    return badRequest(res, 'checkoutRequestId is required.');
  }

  const payment = await prisma.payment.findUnique({ where: { checkoutRequestId } });
  if (!payment) {
    return res.status(404).json({ success: false, error: 'Payment not found' });
  }

  // Already resolved (usually by the callback): no need to bother Daraja.
  if (RESOLVED_STATUSES.includes(payment.status)) {
    return res.json({ success: true, data: { ...toPaymentResult(payment), source: 'database' } });
  }

  let daraja;
  try {
    daraja = await querySTKPushStatus(checkoutRequestId);
  } catch (error) {
    // Daraja unreachable, timed out, rate limited, or "The transaction is being processed".
    console.warn(`Query for ${checkoutRequestId} failed: ${error.message}`);
    return res.json({
      success: true,
      data: { ...toPaymentResult(payment), status: 'pending', message: STILL_PROCESSING },
    });
  }

  if (daraja.ResultCode === undefined || daraja.ResultCode === null) {
    return res.json({
      success: true,
      data: { ...toPaymentResult(payment), status: 'pending', message: STILL_PROCESSING },
    });
  }

  const resultCode = Number(daraja.ResultCode);
  const status = statusFromResultCode(resultCode);

  // Same rule as the callback: only change a pending payment. If the callback
  // arrived while we were waiting for Daraja, keep what the callback saved.
  await updateIfPending(checkoutRequestId, { status, resultCode, resultDesc: daraja.ResultDesc });
  console.log(`Query: payment ${checkoutRequestId} is ${status}: ${daraja.ResultDesc}`);

  const latest = await prisma.payment.findUnique({ where: { checkoutRequestId } });
  res.json({ success: true, data: { ...toPaymentResult(latest), source: 'daraja' } });
});

app.get('/api/payments', async (req, res) => {
  const payments = await prisma.payment.findMany({ orderBy: { createdAt: 'desc' } });
  res.json({ success: true, count: payments.length, data: payments });
});

// What the poll route sends back: only what the payment screens need.
function toPollResult(payment) {
  return {
    id: payment.id,
    checkoutRequestId: payment.checkoutRequestId,
    status: payment.status,
    resultDesc: payment.resultDesc,
    mpesaReceiptNumber: payment.mpesaReceiptNumber,
    amount: payment.amount,
    phoneNumber: payment.phoneNumber,
    createdAt: payment.createdAt,
  };
}

// Asks Daraja about a pending payment, if it is time to. Never throws: a failed
// query just means "still pending", and the next poll can try again.
async function checkWithDarajaIfDue(payment) {
  const now = Date.now();
  const age = now - new Date(payment.createdAt).getTime();
  const last = lastDarajaCheck.get(payment.checkoutRequestId) || 0;
  if (age < DARAJA_CHECK_AFTER_MS || now - last < DARAJA_CHECK_EVERY_MS) return payment;

  lastDarajaCheck.set(payment.checkoutRequestId, now);
  try {
    const daraja = await querySTKPushStatus(payment.checkoutRequestId);
    if (daraja.ResultCode === undefined || daraja.ResultCode === null) return payment;

    const resultCode = Number(daraja.ResultCode);
    const status = statusFromResultCode(resultCode);
    await updateIfPending(payment.checkoutRequestId, { status, resultCode, resultDesc: daraja.ResultDesc });
    console.log(`Poll: Daraja says ${payment.checkoutRequestId} is ${status}: ${daraja.ResultDesc}`);
    return prisma.payment.findUnique({ where: { id: payment.id } });
  } catch (error) {
    console.warn(`Poll: Daraja query for ${payment.checkoutRequestId} failed: ${error.message}`);
    return payment;
  }
}

// Day 4: the payment screen polls this every 3 seconds until the status is not "pending".
// :id is the paymentId returned by POST /api/mpesa/stkpush (a checkoutRequestId works too).
app.get('/api/payments/:id/poll', async (req, res) => {
  const { id } = req.params;
  let payment = await prisma.payment.findFirst({
    where: { OR: [{ id }, { checkoutRequestId: id }] },
  });
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });

  if (payment.status === 'pending') {
    payment = await checkWithDarajaIfDue(payment);
  } else {
    lastDarajaCheck.delete(payment.checkoutRequestId);
  }

  res.json({ success: true, data: toPollResult(payment) });
});

app.get('/api/payments/:checkoutRequestId', async (req, res) => {
  const payment = await prisma.payment.findUnique({
    where: { checkoutRequestId: req.params.checkoutRequestId },
  });
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
  res.json({ success: true, data: payment });
});

app.use((req, res) => {
  res.status(404).json({ success: false, error: `Route ${req.method} ${req.path} not found` });
});

app.use((error, req, res, next) => {
  if (error.type === 'entity.parse.failed') {
    return badRequest(res, 'Request body must be valid JSON.');
  }
  console.error(error);
  res.status(500).json({ success: false, error: 'Internal server error' });
});

const PORT = process.env.PORT || 3000;

if (require.main === module) {
  try {
    const config = validateConfig();
    console.log(`M-Pesa environment: ${config.environment}, shortcode ${config.shortcode}`);
    console.log(`Callback URL: ${config.callbackUrl}`);
  } catch (error) {
    console.error(`Config problem: ${error.message}`);
  }

  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

module.exports = app;
