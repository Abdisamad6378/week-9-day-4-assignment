// All calls to the Express API. The Vite proxy forwards /api/... to http://localhost:3000.

async function request(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (error) {
    if (error.name === 'AbortError') throw error; // we cancelled it on purpose (component unmounted)
    throw new Error('Could not reach the server. Check your connection and try again.');
  }

  // When the Express server is down, the Vite proxy answers with an empty 500, not JSON.
  let body = null;
  try {
    body = await response.json();
  } catch {
    // leave body as null
  }

  if (!response.ok || !body || body.success === false) {
    throw new Error(body?.error || `Server error (HTTP ${response.status}). Is the API running?`);
  }
  return body;
}

// Sends the STK Push. Returns { paymentId, checkoutRequestId }.
export async function initiatePayment({ phoneNumber, amount }) {
  const body = await request('/api/mpesa/stkpush', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phoneNumber, amount }),
  });
  return body.data;
}

// Current status of one payment: { status, resultDesc, mpesaReceiptNumber, amount, phoneNumber, ... }
export async function pollPayment(paymentId) {
  // Give up on one poll after 10 seconds, so a hung request can't block the next ones.
  const body = await request(`/api/payments/${encodeURIComponent(paymentId)}/poll`, {
    signal: AbortSignal.timeout(10000),
  });
  return body.data;
}

export async function getPayments({ signal } = {}) {
  const body = await request('/api/payments', { signal });
  return body.data;
}
