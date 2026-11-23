import { useState } from 'react';
import { initiatePayment } from '../api/payments';
import { formatKES, validateAmount, MIN_AMOUNT, MAX_AMOUNT } from '../utils/format';
import { formatPhoneInput, formatPhoneNumber } from '../utils/phone';

const PHONE_ERROR = 'Enter a valid Kenyan phone number (e.g., 0712 345 678)';

// Collects phone + amount and sends the STK Push.
// Props:
//   fixedAmount     - if set, the amount is shown read-only ("KES 1,500") instead of an input
//   initialPhone    - pre-fills the phone (used by "Try Again")
//   initialAmount   - pre-fills the amount
//   onPaymentStarted({ paymentId, checkoutRequestId, phoneNumber, amount }) - STK Push accepted
export default function PaymentForm({ fixedAmount, initialPhone = '', initialAmount = '', onPaymentStarted }) {
  const [phone, setPhone] = useState(initialPhone);
  const [amountInput, setAmountInput] = useState(initialAmount === '' ? '' : String(initialAmount));
  const [submitted, setSubmitted] = useState(false); // the user pressed Pay at least once
  const [processing, setProcessing] = useState(false);
  const [apiError, setApiError] = useState('');

  const hasFixedAmount = fixedAmount !== undefined && fixedAmount !== null;
  const amount = hasFixedAmount ? fixedAmount : amountInput;

  const phoneResult = formatPhoneNumber(phone);
  const phoneDigits = phone.replace(/\D/g, '');
  // International numbers need 12 digits, so do not complain while one is still being typed.
  const typingInternational = /^\+?254/.test(phone.replace(/\s/g, '')) && phoneDigits.length < 12;
  const showPhoneError =
    !phoneResult.success && (submitted || (phoneDigits.length >= 10 && !typingInternational));

  const amountError = validateAmount(amount);
  const showAmountError = amountError && (submitted || amountInput !== '');

  async function handleSubmit(event) {
    event.preventDefault(); // stay on the page; also what makes Enter work without a reload
    setSubmitted(true);
    setApiError('');
    if (!phoneResult.success || amountError || processing) return;

    setProcessing(true);
    try {
      const { paymentId, checkoutRequestId } = await initiatePayment({
        phoneNumber: phoneResult.formatted,
        amount: Number(amount),
      });
      onPaymentStarted({ paymentId, checkoutRequestId, phoneNumber: phoneResult.formatted, amount: Number(amount) });
    } catch (error) {
      setApiError(error.message);
      setProcessing(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      <div>
        <label htmlFor="phone" className="mb-1 block text-sm font-medium text-gray-700">
          M-Pesa phone number
        </label>
        <input
          id="phone"
          type="tel"
          inputMode="numeric"
          autoComplete="tel"
          placeholder="0712 345 678"
          value={phone}
          onChange={(e) => setPhone(formatPhoneInput(e.target.value))}
          disabled={processing}
          aria-invalid={showPhoneError}
          aria-describedby={showPhoneError ? 'phone-error' : undefined}
          className={`w-full rounded-lg border px-4 py-3 text-lg tracking-wide outline-none focus:ring-2 ${
            showPhoneError
              ? 'border-red-500 focus:ring-red-200'
              : 'border-gray-300 focus:border-green-600 focus:ring-green-200'
          }`}
        />
        {showPhoneError && (
          <p id="phone-error" className="mt-1 text-sm text-red-600">
            {PHONE_ERROR}
          </p>
        )}
      </div>

      {hasFixedAmount ? (
        <div>
          <p className="mb-1 text-sm font-medium text-gray-700">Amount</p>
          <p className="text-4xl font-bold text-gray-900">{formatKES(fixedAmount)}</p>
        </div>
      ) : (
        <div>
          <label htmlFor="amount" className="mb-1 block text-sm font-medium text-gray-700">
            Amount
          </label>
          <div className="relative">
            <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-4 font-semibold text-gray-500">
              KES
            </span>
            <input
              id="amount"
              type="number"
              min={MIN_AMOUNT}
              max={MAX_AMOUNT}
              step="1"
              placeholder="1500"
              value={amountInput}
              onChange={(e) => setAmountInput(e.target.value)}
              disabled={processing}
              aria-invalid={Boolean(showAmountError)}
              className={`w-full rounded-lg border py-3 pl-16 pr-4 text-lg outline-none focus:ring-2 ${
                showAmountError
                  ? 'border-red-500 focus:ring-red-200'
                  : 'border-gray-300 focus:border-green-600 focus:ring-green-200'
              }`}
            />
          </div>
          {showAmountError && <p className="mt-1 text-sm text-red-600">{amountError}</p>}
        </div>
      )}

      {apiError && (
        <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {apiError}
        </div>
      )}

      <button
        type="submit"
        disabled={processing}
        className="w-full rounded-lg bg-green-600 px-4 py-3 text-lg font-semibold text-white transition hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {processing ? 'Sending M-Pesa prompt...' : amountError ? 'Pay Now' : `Pay ${formatKES(amount)}`}
      </button>

      <p className="text-center text-sm text-gray-500">
        You will receive an M-Pesa prompt on your phone to confirm the payment.
      </p>
    </form>
  );
}
