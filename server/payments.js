// Payment logic shared by the routes: reading callbacks, idempotency and status updates.

const prisma = require('./db');

const RESOLVED_STATUSES = ['completed', 'failed', 'cancelled'];
const CANCELLED_BY_USER = 1032;

// ResultCode -> our status. Works for numbers (callback) and strings (query API sends "0", "1032").
function statusFromResultCode(resultCode) {
  const code = Number(resultCode);
  if (code === 0) return 'completed';
  if (code === CANCELLED_BY_USER) return 'cancelled';
  return 'failed';
}

// CallbackMetadata.Item is a list of { Name, Value }. Find one by name, or null.
function getCallbackValue(metadata, name) {
  if (!metadata || !Array.isArray(metadata.Item)) return null;
  const item = metadata.Item.find((entry) => entry.Name === name);
  return item && item.Value !== undefined ? item.Value : null;
}

// Updates the payment only if it is still pending. The status check is part of the
// UPDATE itself (WHERE status = 'pending'), so two callbacks arriving at the same moment
// cannot both succeed. Returns true if this call did the update.
async function updateIfPending(checkoutRequestId, data) {
  const result = await prisma.payment.updateMany({
    where: { checkoutRequestId, status: 'pending' },
    data,
  });
  return result.count === 1;
}

// Handles one Safaricom callback body. Returns what happened so tests can check it:
// "invalid" | "unknown" | "duplicate" | "completed" | "failed" | "cancelled"
async function processCallback(body) {
  const callback = body?.Body?.stkCallback;
  if (!callback || !callback.CheckoutRequestID) {
    console.warn('Callback ignored: body is missing Body.stkCallback.CheckoutRequestID');
    return { action: 'invalid' };
  }

  const { ResultCode, ResultDesc, MerchantRequestID, CheckoutRequestID, CallbackMetadata } = callback;

  // Task 2: idempotency
  const payment = await prisma.payment.findUnique({ where: { checkoutRequestId: CheckoutRequestID } });

  if (!payment) {
    console.warn(`Callback for unknown CheckoutRequestID: ${CheckoutRequestID}. Ignoring.`);
    return { action: 'unknown' };
  }

  if (payment.status !== 'pending') {
    console.log(`Duplicate callback for ${CheckoutRequestID}. Already ${payment.status}. Skipping.`);
    return { action: 'duplicate', status: payment.status };
  }

  const resultCode = Number(ResultCode);
  const status = statusFromResultCode(resultCode);
  const data = {
    status,
    resultCode,
    resultDesc: ResultDesc,
    merchantRequestId: MerchantRequestID || payment.merchantRequestId,
  };

  if (status === 'completed') {
    const amount = getCallbackValue(CallbackMetadata, 'Amount');
    const receipt = getCallbackValue(CallbackMetadata, 'MpesaReceiptNumber');
    const transactionDate = getCallbackValue(CallbackMetadata, 'TransactionDate');
    const phoneNumber = getCallbackValue(CallbackMetadata, 'PhoneNumber');

    data.mpesaReceiptNumber = receipt;
    // Safaricom sends these as numbers (20260504143055, 254712345678). The schema stores them as strings.
    if (transactionDate !== null) data.transactionDate = String(transactionDate);
    if (phoneNumber !== null) data.phoneNumber = String(phoneNumber);
    if (amount !== null) data.amount = Number(amount);
  }

  const updated = await updateIfPending(CheckoutRequestID, data);
  if (!updated) {
    // Another callback got there between our read and our update.
    console.log(`Duplicate callback for ${CheckoutRequestID}. Already processed. Skipping.`);
    return { action: 'duplicate' };
  }

  if (status === 'completed') {
    console.log(`Payment ${CheckoutRequestID} completed. Receipt: ${data.mpesaReceiptNumber}`);
  } else {
    console.log(`Payment ${CheckoutRequestID} ${status}: ${ResultDesc}`);
  }

  return { action: status };
}

// The shape returned by the query endpoint.
function toPaymentResult(payment) {
  return {
    checkoutRequestId: payment.checkoutRequestId,
    status: payment.status,
    resultCode: payment.resultCode,
    resultDesc: payment.resultDesc,
    mpesaReceiptNumber: payment.mpesaReceiptNumber,
    amount: payment.amount,
    phoneNumber: payment.phoneNumber,
  };
}

module.exports = {
  RESOLVED_STATUSES,
  statusFromResultCode,
  getCallbackValue,
  updateIfPending,
  processCallback,
  toPaymentResult,
};
