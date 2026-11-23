// Daraja helpers: OAuth access token (with caching), timestamp, STK Push password,
// STK Push request and STK Push Query (status check).

const axios = require('axios');
const { validateConfig, getBaseUrl, getBase64Credentials } = require('./config');
const { formatPhoneNumber } = require('./phone');

// Refresh the token 60 seconds before Daraja says it expires,
// so we never send a request with a token that dies on the way.
const EXPIRY_BUFFER_MS = 60 * 1000;

// Module-level cache. Lives as long as the Node process.
let cachedToken = null;
let tokenExpiresAt = 0; // timestamp in ms

function isTokenCached() {
  return cachedToken !== null && Date.now() < tokenExpiresAt;
}

function clearTokenCache() {
  cachedToken = null;
  tokenExpiresAt = 0;
}

async function getAccessToken() {
  if (isTokenCached()) {
    return cachedToken;
  }

  // Fails early with a clear message if the .env is incomplete.
  validateConfig();

  const url = `${getBaseUrl()}/oauth/v1/generate?grant_type=client_credentials`;

  try {
    const response = await axios.get(url, {
      headers: { Authorization: `Basic ${getBase64Credentials()}` },
      timeout: 10000,
    });

    const { access_token, expires_in } = response.data || {};
    if (!access_token) {
      throw new Error('Daraja response did not include an access_token');
    }

    // Daraja sends expires_in as a string of seconds, usually "3599".
    const lifetimeMs = (Number(expires_in) || 3599) * 1000;
    cachedToken = access_token;
    tokenExpiresAt = Date.now() + lifetimeMs - EXPIRY_BUFFER_MS;

    return cachedToken;
  } catch (error) {
    // Never keep a token we are not sure about.
    clearTokenCache();

    if (error.response) {
      // Daraja answered, but with an error (wrong key/secret gives 400 or 401).
      const { status, data } = error.response;
      const detail =
        (data && (data.errorMessage || data.error_description || data.error)) ||
        error.response.statusText ||
        'no details';
      const err = new Error(`Daraja authentication failed (HTTP ${status}): ${detail}`);
      err.statusCode = status === 400 || status === 401 ? 401 : 502;
      throw err;
    }

    if (error.request) {
      // The request went out but nothing came back: DNS, no internet, timeout.
      const err = new Error(`Could not reach Daraja at ${getBaseUrl()}: ${error.code || error.message}`);
      err.statusCode = 503;
      throw err;
    }

    throw error;
  }
}

// Current local time as YYYYMMDDHHmmss, e.g. "20260503143045".
function getTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    date.getFullYear() +
    pad(date.getMonth() + 1) + // getMonth() is 0-based
    pad(date.getDate()) +
    pad(date.getHours()) +
    pad(date.getMinutes()) +
    pad(date.getSeconds())
  );
}

// Base64(Shortcode + Passkey + Timestamp). The same timestamp must go into the STK Push body.
function generatePassword(timestamp) {
  if (!timestamp) {
    throw new Error('generatePassword needs the timestamp used in the STK Push request');
  }
  const shortcode = process.env.MPESA_SHORTCODE;
  const passkey = process.env.MPESA_PASSKEY;
  if (!shortcode || !passkey) {
    throw new Error('Missing MPESA_SHORTCODE or MPESA_PASSKEY');
  }
  return Buffer.from(`${shortcode}${passkey}${timestamp}`).toString('base64');
}

const MIN_AMOUNT = 1;
const MAX_AMOUNT = 150000; // Safaricom's per-transaction limit

// An error the client caused (bad input). The server turns statusCode into the HTTP status.
function validationError(message) {
  const err = new Error(message);
  err.statusCode = 400;
  return err;
}

// Returns the amount as a number, or throws a 400 error.
// Accepts 100 or "100", rejects 0, 200000, 10.5, "abc".
function validateAmount(amount) {
  if (amount === undefined || amount === null || String(amount).trim() === '') {
    throw validationError('Amount is required.');
  }
  const value = Number(amount);
  if (Number.isNaN(value)) {
    throw validationError('Amount must be a number.');
  }
  if (!Number.isInteger(value)) {
    throw validationError('Amount must be a whole number of KES (M-Pesa does not accept cents).');
  }
  if (value < MIN_AMOUNT || value > MAX_AMOUNT) {
    throw validationError('Amount must be between 1 and 150,000 KES');
  }
  return value;
}

// Sends the "enter your M-Pesa PIN" prompt to the customer's phone.
// Returns Daraja's reply: MerchantRequestID, CheckoutRequestID, ResponseCode, ResponseDescription, CustomerMessage.
// ResponseCode "0" only means Safaricom accepted the request. Whether the customer paid comes later, on the callback.
async function initiateSTKPush(phoneNumber, amount, accountReference, transactionDesc) {
  const phone = formatPhoneNumber(phoneNumber);
  if (!phone.success) {
    throw validationError(phone.error);
  }
  const validAmount = validateAmount(amount);

  const config = validateConfig();
  const token = await getAccessToken();

  // One timestamp, used for both the password and the payload, so Safaricom can rebuild the password.
  const timestamp = getTimestamp();
  const password = generatePassword(timestamp);

  const payload = {
    BusinessShortCode: config.shortcode,
    Password: password,
    Timestamp: timestamp,
    TransactionType: 'CustomerPayBillOnline',
    Amount: validAmount,
    PartyA: phone.formatted, // the phone paying
    PartyB: config.shortcode, // the till/paybill receiving
    PhoneNumber: phone.formatted, // the phone that gets the prompt
    CallBackURL: config.callbackUrl,
    AccountReference: accountReference || 'Payment',
    TransactionDesc: transactionDesc || 'Payment',
  };

  try {
    const response = await axios.post(`${getBaseUrl()}/mpesa/stkpush/v1/processrequest`, payload, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;
      // A 401 here means the token was rejected, so do not keep using it.
      if (status === 401) clearTokenCache();
      const detail = (data && (data.errorMessage || data.ResponseDescription)) || error.response.statusText;
      const err = new Error(`STK Push failed (HTTP ${status}): ${detail}`);
      err.statusCode = 502;
      err.darajaError = data;
      throw err;
    }
    if (error.request) {
      const err = new Error(`Could not reach Daraja at ${getBaseUrl()}: ${error.code || error.message}`);
      err.statusCode = 503;
      throw err;
    }
    throw error;
  }
}

// Asks Daraja what happened to an STK Push.
// Returns Daraja's reply, e.g. { ResponseCode: "0", ResultCode: "1032", ResultDesc: "Request cancelled by user" }.
// Throws if Daraja cannot be reached or refuses the query. While the customer has not answered yet,
// Daraja replies with HTTP 500 "The transaction is being processed", which also ends up as a throw.
async function querySTKPushStatus(checkoutRequestId) {
  if (!checkoutRequestId) {
    throw validationError('checkoutRequestId is required.');
  }

  const config = validateConfig();
  const token = await getAccessToken();
  const timestamp = getTimestamp();

  const payload = {
    BusinessShortCode: config.shortcode,
    Password: generatePassword(timestamp),
    Timestamp: timestamp,
    CheckoutRequestID: checkoutRequestId,
  };

  try {
    const response = await axios.post(`${getBaseUrl()}/mpesa/stkpushquery/v1/query`, payload, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      timeout: 15000,
    });
    return response.data;
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;
      if (status === 401) clearTokenCache();
      const detail =
        (data && (data.errorMessage || data.fault?.faultstring || data.ResponseDescription)) ||
        error.response.statusText;
      const err = new Error(`STK Push query failed (HTTP ${status}): ${detail}`);
      err.statusCode = 502;
      err.darajaError = data;
      throw err;
    }
    if (error.request) {
      const err = new Error(`Could not reach Daraja at ${getBaseUrl()}: ${error.code || error.message}`);
      err.statusCode = 503;
      throw err;
    }
    throw error;
  }
}

module.exports = {
  initiateSTKPush,
  querySTKPushStatus,
  validateAmount,
  getAccessToken,
  isTokenCached,
  clearTokenCache,
  getTimestamp,
  generatePassword,
};
