// Run with: npm test   (needs the Postgres database from .env, run `npx prisma migrate deploy` once first)
// Uses the real database with its own test IDs (ws_CO_UNITTEST_...), which are deleted before and after.
// Daraja is never called: axios.get / axios.post are replaced with fakes.

require('dotenv').config({ quiet: true });
const { test, describe, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const axios = require('axios');

Object.assign(process.env, {
  MPESA_CONSUMER_KEY: 'test_key',
  MPESA_CONSUMER_SECRET: 'test_secret',
  MPESA_SHORTCODE: '174379',
  MPESA_PASSKEY: 'bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919',
  MPESA_ENV: 'sandbox',
  MPESA_CALLBACK_URL: 'https://example.com/api/mpesa/callback',
});

const prisma = require('./db');
const app = require('./server');
const { getCallbackValue, statusFromResultCode, processCallback } = require('./payments');
const { clearTokenCache } = require('./mpesa');

const PREFIX = 'ws_CO_UNITTEST_';
const realGet = axios.get;
const realPost = axios.post;

let server;
let baseUrl;
let idCounter = 0;

const newId = () => `${PREFIX}${Date.now()}_${++idCounter}`;

async function createPending(checkoutRequestId) {
  return prisma.payment.create({
    data: { checkoutRequestId, phoneNumber: '254712345678', amount: 100, accountReference: 'PayLink' },
  });
}

function successBody(checkoutRequestId, receipt = 'SHK4G7Y8DR') {
  return {
    Body: {
      stkCallback: {
        MerchantRequestID: '29115-34620561-1',
        CheckoutRequestID: checkoutRequestId,
        ResultCode: 0,
        ResultDesc: 'The service request is processed successfully.',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: 100 },
            { Name: 'MpesaReceiptNumber', Value: receipt },
            { Name: 'TransactionDate', Value: 20260504143055 },
            { Name: 'PhoneNumber', Value: 254712345678 },
          ],
        },
      },
    },
  };
}

function failureBody(checkoutRequestId, ResultCode, ResultDesc) {
  return {
    Body: {
      stkCallback: { MerchantRequestID: '29115-34620561-1', CheckoutRequestID: checkoutRequestId, ResultCode, ResultDesc },
    },
  };
}

const findPayment = (checkoutRequestId) => prisma.payment.findUnique({ where: { checkoutRequestId } });

// Fake Daraja. `queryReply` is what the STK Push Query returns (or a function that throws).
function fakeDaraja(queryReply) {
  const calls = [];
  axios.get = async () => ({ data: { access_token: 'fake-token', expires_in: '3599' } });
  axios.post = async (url, body) => {
    calls.push({ url, body });
    if (typeof queryReply === 'function') return queryReply();
    return { data: queryReply };
  };
  return calls;
}

// Our own API is called with fetch, so faking axios does not affect it.
async function api(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

async function waitForStatus(checkoutRequestId, notStatus, timeoutMs = 2000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    const payment = await findPayment(checkoutRequestId);
    if (payment && payment.status !== notStatus) return payment;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return findPayment(checkoutRequestId);
}

before(async () => {
  await prisma.payment.deleteMany({ where: { checkoutRequestId: { startsWith: PREFIX } } });
  server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://localhost:${server.address().port}`;
});

after(async () => {
  await prisma.payment.deleteMany({ where: { checkoutRequestId: { startsWith: PREFIX } } });
  server.close();
  await prisma.$disconnect();
});

beforeEach(() => clearTokenCache());

afterEach(() => {
  axios.get = realGet;
  axios.post = realPost;
});

describe('helpers', () => {
  test('getCallbackValue() finds a value by Name', () => {
    const metadata = successBody('x').Body.stkCallback.CallbackMetadata;
    assert.equal(getCallbackValue(metadata, 'MpesaReceiptNumber'), 'SHK4G7Y8DR');
    assert.equal(getCallbackValue(metadata, 'Amount'), 100);
    assert.equal(getCallbackValue(metadata, 'PhoneNumber'), 254712345678);
  });

  test('getCallbackValue() returns null when missing', () => {
    const metadata = successBody('x').Body.stkCallback.CallbackMetadata;
    assert.equal(getCallbackValue(metadata, 'Balance'), null);
    assert.equal(getCallbackValue(undefined, 'Amount'), null);
    assert.equal(getCallbackValue({}, 'Amount'), null);
  });

  test('statusFromResultCode() handles numbers and strings', () => {
    assert.equal(statusFromResultCode(0), 'completed');
    assert.equal(statusFromResultCode('0'), 'completed');
    assert.equal(statusFromResultCode(1032), 'cancelled');
    assert.equal(statusFromResultCode('1032'), 'cancelled');
    assert.equal(statusFromResultCode(1), 'failed');
    assert.equal(statusFromResultCode('1037'), 'failed');
  });
});

describe('Task 1: callback handler', () => {
  test('responds 200 Accepted straight away, even to a bad body', async () => {
    const { status, body } = await api('/api/mpesa/callback', { nonsense: true });
    assert.equal(status, 200);
    assert.deepEqual(body, { ResultCode: 0, ResultDesc: 'Accepted' });
  });

  test('successful payment -> completed with receipt, date, phone and amount', async () => {
    const id = newId();
    await createPending(id);

    const result = await processCallback(successBody(id));
    assert.equal(result.action, 'completed');

    const payment = await findPayment(id);
    assert.equal(payment.status, 'completed');
    assert.equal(payment.resultCode, 0);
    assert.equal(payment.resultDesc, 'The service request is processed successfully.');
    assert.equal(payment.mpesaReceiptNumber, 'SHK4G7Y8DR');
    assert.equal(payment.transactionDate, '20260504143055');
    assert.equal(payment.phoneNumber, '254712345678');
    assert.equal(payment.amount, 100);
  });

  test('ResultCode 1032 -> cancelled', async () => {
    const id = newId();
    await createPending(id);

    await processCallback(failureBody(id, 1032, 'Request cancelled by user.'));

    const payment = await findPayment(id);
    assert.equal(payment.status, 'cancelled');
    assert.equal(payment.resultCode, 1032);
    assert.equal(payment.resultDesc, 'Request cancelled by user.');
    assert.equal(payment.mpesaReceiptNumber, null);
  });

  test('other ResultCodes -> failed', async () => {
    const id = newId();
    await createPending(id);

    await processCallback(failureBody(id, 1, 'The balance is insufficient for the transaction.'));

    const payment = await findPayment(id);
    assert.equal(payment.status, 'failed');
    assert.equal(payment.resultCode, 1);
  });

  test('works through the real endpoint too', async () => {
    const id = newId();
    await createPending(id);

    const { status } = await api('/api/mpesa/callback', successBody(id));
    assert.equal(status, 200);

    const payment = await waitForStatus(id, 'pending');
    assert.equal(payment.status, 'completed');
  });
});

describe('Task 2: idempotency', () => {
  test('the same callback twice only updates the database once', async () => {
    const id = newId();
    await createPending(id);

    const first = await processCallback(successBody(id));
    const afterFirst = await findPayment(id);

    // Same CheckoutRequestID, but a different receipt, so a second update would be visible.
    const second = await processCallback(successBody(id, 'DIFFERENT1'));
    const afterSecond = await findPayment(id);

    assert.equal(first.action, 'completed');
    assert.equal(second.action, 'duplicate');
    assert.equal(afterSecond.mpesaReceiptNumber, 'SHK4G7Y8DR');
    assert.equal(afterSecond.updatedAt.getTime(), afterFirst.updatedAt.getTime(), 'row was not touched again');
  });

  test('a late "cancelled" callback cannot overwrite a completed payment', async () => {
    const id = newId();
    await createPending(id);

    await processCallback(successBody(id));
    const late = await processCallback(failureBody(id, 1032, 'Request cancelled by user.'));

    assert.equal(late.action, 'duplicate');
    assert.equal((await findPayment(id)).status, 'completed');
  });

  test('two callbacks at the same moment: only one wins', async () => {
    const id = newId();
    await createPending(id);

    const results = await Promise.all([processCallback(successBody(id)), processCallback(successBody(id))]);
    const actions = results.map((r) => r.action).sort();

    assert.deepEqual(actions, ['completed', 'duplicate']);
  });

  test('sending it twice through the endpoint: second is skipped', async () => {
    const id = newId();
    await createPending(id);

    await api('/api/mpesa/callback', successBody(id));
    const afterFirst = await waitForStatus(id, 'pending');

    await api('/api/mpesa/callback', successBody(id, 'DIFFERENT2'));
    await new Promise((resolve) => setTimeout(resolve, 200)); // give the background processing time
    const afterSecond = await findPayment(id);

    assert.equal(afterSecond.mpesaReceiptNumber, 'SHK4G7Y8DR');
    assert.equal(afterSecond.updatedAt.getTime(), afterFirst.updatedAt.getTime());
  });

  test('callback for an unknown CheckoutRequestID is ignored and creates nothing', async () => {
    const id = newId();
    const result = await processCallback(successBody(id));

    assert.equal(result.action, 'unknown');
    assert.equal(await findPayment(id), null);
  });
});

describe('Task 3: POST /api/mpesa/query', () => {
  test('unknown ID -> 404', async () => {
    const { status, body } = await api('/api/mpesa/query', { checkoutRequestId: newId() });
    assert.equal(status, 404);
    assert.deepEqual(body, { success: false, error: 'Payment not found' });
  });

  test('missing checkoutRequestId -> 400', async () => {
    const { status } = await api('/api/mpesa/query', {});
    assert.equal(status, 400);
  });

  test('completed payment is answered from the database without calling Daraja', async () => {
    const id = newId();
    await createPending(id);
    await processCallback(successBody(id));
    const calls = fakeDaraja({});

    const { status, body } = await api('/api/mpesa/query', { checkoutRequestId: id });

    assert.equal(status, 200);
    assert.equal(calls.length, 0, 'Daraja should not be called');
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'completed');
    assert.equal(body.data.resultCode, 0);
    assert.equal(body.data.mpesaReceiptNumber, 'SHK4G7Y8DR');
    assert.equal(body.data.amount, 100);
    assert.equal(body.data.phoneNumber, '254712345678');
  });

  test('pending payment: asks Daraja with the right payload and saves "cancelled" for 1032', async () => {
    const id = newId();
    await createPending(id);
    const calls = fakeDaraja({
      ResponseCode: '0',
      ResponseDescription: 'The service request has been accepted successsfully',
      CheckoutRequestID: id,
      ResultCode: '1032',
      ResultDesc: 'Request cancelled by user',
    });

    const { body } = await api('/api/mpesa/query', { checkoutRequestId: id });

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://sandbox.safaricom.co.ke/mpesa/stkpushquery/v1/query');
    assert.equal(calls[0].body.BusinessShortCode, '174379');
    assert.equal(calls[0].body.CheckoutRequestID, id);
    assert.match(calls[0].body.Timestamp, /^\d{14}$/);
    assert.equal(
      Buffer.from(calls[0].body.Password, 'base64').toString(),
      '174379' + process.env.MPESA_PASSKEY + calls[0].body.Timestamp
    );

    assert.equal(body.data.status, 'cancelled');
    assert.equal(body.data.resultCode, 1032);
    assert.equal((await findPayment(id)).status, 'cancelled');
  });

  test('pending payment: ResultCode "0" -> completed, other codes -> failed', async () => {
    const paid = newId();
    const timedOut = newId();
    await createPending(paid);
    await createPending(timedOut);

    fakeDaraja({ ResponseCode: '0', ResultCode: '0', ResultDesc: 'The service request is processed successfully.' });
    assert.equal((await api('/api/mpesa/query', { checkoutRequestId: paid })).body.data.status, 'completed');

    fakeDaraja({ ResponseCode: '0', ResultCode: '1037', ResultDesc: 'DS timeout user cannot be reached' });
    assert.equal((await api('/api/mpesa/query', { checkoutRequestId: timedOut })).body.data.status, 'failed');
  });

  test('Daraja unreachable -> still pending, with a try-again message', async () => {
    const id = newId();
    await createPending(id);
    fakeDaraja(() => {
      const error = new Error('timeout of 15000ms exceeded');
      error.code = 'ECONNABORTED';
      error.request = {};
      throw error;
    });

    const { status, body } = await api('/api/mpesa/query', { checkoutRequestId: id });

    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.status, 'pending');
    assert.equal(body.data.message, 'Payment is still being processed. Try again in a few seconds.');
    assert.equal((await findPayment(id)).status, 'pending');
  });

  test('Daraja "transaction is being processed" (HTTP 500) -> still pending', async () => {
    const id = newId();
    await createPending(id);
    fakeDaraja(() => {
      const error = new Error('Request failed with status code 500');
      error.response = {
        status: 500,
        data: { errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' },
      };
      throw error;
    });

    const { body } = await api('/api/mpesa/query', { checkoutRequestId: id });
    assert.equal(body.data.status, 'pending');
  });
});

// Day 4: the React payment screen polls this route every 3 seconds.
describe('GET /api/payments/:id/poll', () => {
  const get = async (path) => {
    const response = await fetch(`${baseUrl}${path}`);
    return { status: response.status, body: await response.json() };
  };

  test('unknown id -> 404', async () => {
    const { status, body } = await get('/api/payments/does-not-exist/poll');
    assert.equal(status, 404);
    assert.equal(body.error, 'Payment not found');
  });

  test('new pending payment: answers "pending" without calling Daraja', async () => {
    const id = newId();
    const payment = await createPending(id);
    const calls = fakeDaraja({ ResultCode: '0', ResultDesc: 'should not be used' });

    const { status, body } = await get(`/api/payments/${payment.id}/poll`);

    assert.equal(status, 200);
    assert.equal(body.data.id, payment.id);
    assert.equal(body.data.status, 'pending');
    assert.equal(calls.length, 0);
  });

  test('after a success callback: completed with the receipt (paymentId or checkoutRequestId)', async () => {
    const id = newId();
    const payment = await createPending(id);
    await processCallback(successBody(id, 'SHK4G7Y8DR'));

    for (const key of [payment.id, id]) {
      const { body } = await get(`/api/payments/${key}/poll`);
      assert.equal(body.data.status, 'completed');
      assert.equal(body.data.mpesaReceiptNumber, 'SHK4G7Y8DR');
      assert.equal(body.data.amount, 100);
      assert.equal(body.data.phoneNumber, '254712345678');
    }
  });

  test('after a cancelled callback: cancelled with resultDesc for the failure screen', async () => {
    const id = newId();
    const payment = await createPending(id);
    await processCallback(failureBody(id, 1032, 'Request cancelled by user.'));

    const { body } = await get(`/api/payments/${payment.id}/poll`);
    assert.equal(body.data.status, 'cancelled');
    assert.equal(body.data.resultDesc, 'Request cancelled by user.');
  });

  test('pending for over 15 s with no callback: asks Daraja once, then waits 10 s before asking again', async () => {
    const id = newId();
    const payment = await prisma.payment.create({
      data: {
        checkoutRequestId: id,
        phoneNumber: '254712345678',
        amount: 100,
        createdAt: new Date(Date.now() - 20 * 1000),
      },
    });
    const calls = fakeDaraja(() => {
      const error = new Error('Request failed with status code 500');
      error.response = { status: 500, data: { errorMessage: 'The transaction is being processed' } };
      throw error;
    });

    const first = await get(`/api/payments/${payment.id}/poll`);
    const second = await get(`/api/payments/${payment.id}/poll`);

    assert.equal(first.body.data.status, 'pending');
    assert.equal(second.body.data.status, 'pending');
    assert.equal(calls.filter((c) => c.url.includes('stkpushquery')).length, 1);
  });

  test('Daraja query result 1032 is saved and returned as cancelled', async () => {
    const id = newId();
    const payment = await prisma.payment.create({
      data: { checkoutRequestId: id, phoneNumber: '254712345678', amount: 100, createdAt: new Date(Date.now() - 20 * 1000) },
    });
    fakeDaraja({ ResponseCode: '0', ResultCode: '1032', ResultDesc: 'Request cancelled by user' });

    const { body } = await get(`/api/payments/${payment.id}/poll`);
    assert.equal(body.data.status, 'cancelled');
    assert.equal(body.data.resultDesc, 'Request cancelled by user');
    assert.equal((await findPayment(id)).status, 'cancelled');
  });
});
