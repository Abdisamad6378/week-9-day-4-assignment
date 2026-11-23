import { formatKES } from '../utils/format';
import { formatPhoneDisplay } from '../utils/phone';

export default function SuccessScreen({ payment, onReset }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
        <svg className="h-9 w-9 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
      </div>
      <h2 className="mt-6 text-2xl font-bold text-gray-900">Payment Successful</h2>
      <p className="mt-2 text-gray-600">Your payment of {formatKES(payment.amount)} has been received.</p>

      {/* M-Pesa style receipt */}
      <dl className="mt-6 w-full divide-y divide-gray-200 rounded-lg border border-gray-200 text-left text-sm">
        <div className="flex justify-between p-3">
          <dt className="text-gray-500">M-Pesa Receipt</dt>
          <dd className="font-mono font-semibold text-gray-900">{payment.mpesaReceiptNumber || '-'}</dd>
        </div>
        <div className="flex justify-between p-3">
          <dt className="text-gray-500">Amount</dt>
          <dd className="font-medium text-gray-900">{formatKES(payment.amount)}</dd>
        </div>
        <div className="flex justify-between p-3">
          <dt className="text-gray-500">Phone</dt>
          <dd className="font-medium text-gray-900">{formatPhoneDisplay(payment.phoneNumber)}</dd>
        </div>
        <div className="flex justify-between p-3">
          <dt className="text-gray-500">Status</dt>
          <dd className="font-semibold text-green-600">Confirmed</dd>
        </div>
      </dl>

      <button
        type="button"
        onClick={onReset}
        className="mt-6 w-full rounded-lg bg-green-600 px-4 py-3 font-semibold text-white hover:bg-green-700"
      >
        Make Another Payment
      </button>
    </div>
  );
}
