import { usePaymentPolling, MAX_POLLS } from '../hooks/usePaymentPolling';
import { formatKES } from '../utils/format';
import { formatPhoneDisplay } from '../utils/phone';

// "Check your phone" screen. Polling starts when this mounts and stops when it unmounts.
export default function ProcessingScreen({ payment, onResult, onCancel }) {
  const pollCount = usePaymentPolling(payment.paymentId, onResult);

  return (
    <div className="flex flex-col items-center text-center">
      <div
        role="status"
        aria-label="Waiting for payment"
        className="h-16 w-16 animate-spin rounded-full border-4 border-green-100 border-t-green-600"
      />
      <h2 className="mt-6 text-2xl font-bold text-gray-900">Waiting for payment...</h2>
      <p className="mt-2 text-gray-600">
        Payment prompt sent. Please check your phone and enter your M-Pesa PIN.
      </p>

      <dl className="mt-6 w-full space-y-2 rounded-lg bg-gray-50 p-4 text-left text-sm">
        <div className="flex justify-between">
          <dt className="text-gray-500">Phone number</dt>
          <dd className="font-medium text-gray-900">{formatPhoneDisplay(payment.phoneNumber)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-gray-500">Amount</dt>
          <dd className="font-medium text-gray-900">{formatKES(payment.amount)}</dd>
        </div>
      </dl>

      <p className="mt-4 text-xs text-gray-400">
        {pollCount === 0 ? 'Checking status every 3 seconds' : `Checked ${pollCount} of ${MAX_POLLS} times`}
      </p>

      <button type="button" onClick={onCancel} className="mt-4 text-sm font-medium text-green-700 underline hover:text-green-800">
        Cancel and go back
      </button>
    </div>
  );
}
