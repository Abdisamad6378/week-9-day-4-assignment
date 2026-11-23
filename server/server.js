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

const badRequest = (res, error) => res.status(400).json({ success: false, error });

app.get('/', (req, res) => {
  res.json({
    message: 'Week 9 Day 3: M-Pesa callbacks',
    endpoints: [
      'GET  /api/health',
      'POST /api/mpesa/stkpush',
      'POST /api/mpesa/callback',
      'POST /api/mpesa/query',
      'GET  /api/payments',
      'GET  /api/payments/:checkoutRequestId',
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
