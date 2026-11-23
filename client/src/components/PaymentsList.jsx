import { useEffect, useState } from 'react';
import { getPayments } from '../api/payments';
import { formatDateTime, formatKES } from '../utils/format';
import { maskPhone } from '../utils/phone';
import StatusBadge from './StatusBadge';

// Newest first. The API already sorts, but the list should not depend on that.
const newestFirst = (a, b) => new Date(b.createdAt) - new Date(a.createdAt);

export default function PaymentsList() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [refreshKey, setRefreshKey] = useState(0); // bump it to fetch again

  // Fetch on mount, and again whenever refreshKey changes (the Refresh button).
  // State is only set when the request comes back. The AbortController cancels the
  // request if the component unmounts first, so we never set state on a dead component.
  useEffect(() => {
    const controller = new AbortController();
    getPayments({ signal: controller.signal })
      .then((data) => {
        setPayments([...data].sort(newestFirst));
        setError('');
        setLoading(false);
      })
      .catch((err) => {
        if (err.name === 'AbortError') return;
        setError(err.message);
        setLoading(false);
      });
    return () => controller.abort();
  }, [refreshKey]);

  function refresh() {
    setLoading(true);
    setError('');
    setRefreshKey((key) => key + 1);
  }

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-gray-900">Payments</h2>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          className="rounded-lg border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Refresh
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center gap-3 py-12 text-gray-500">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-200 border-t-green-600" />
          Loading payments...
        </div>
      ) : error ? (
        <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : payments.length === 0 ? (
        <p className="py-12 text-center text-gray-500">No payments yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
              <tr>
                <th className="py-3 pr-4 font-medium">Date</th>
                <th className="py-3 pr-4 font-medium">Phone</th>
                <th className="py-3 pr-4 text-right font-medium">Amount</th>
                <th className="py-3 pr-4 font-medium">Status</th>
                <th className="py-3 font-medium">Receipt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {payments.map((payment) => (
                <tr key={payment.id} className="hover:bg-gray-50">
                  <td className="whitespace-nowrap py-3 pr-4 text-gray-700">{formatDateTime(payment.createdAt)}</td>
                  <td className="py-3 pr-4 font-mono text-gray-700">{maskPhone(payment.phoneNumber)}</td>
                  <td className="whitespace-nowrap py-3 pr-4 text-right font-medium text-gray-900">
                    {formatKES(payment.amount)}
                  </td>
                  <td className="py-3 pr-4">
                    <StatusBadge status={payment.status} />
                  </td>
                  <td className="py-3 font-mono text-gray-700">{payment.mpesaReceiptNumber || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
