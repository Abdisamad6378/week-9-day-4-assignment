import { useState } from 'react';
import PaymentFlow from './components/PaymentFlow';
import PaymentsList from './components/PaymentsList';

const TABS = [
  { id: 'pay', label: 'Pay' },
  { id: 'checkout', label: 'Checkout (fixed amount)' },
  { id: 'payments', label: 'Payments' },
];

export default function App() {
  const [tab, setTab] = useState('pay');

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-green-700 text-white">
        <div className="mx-auto max-w-4xl px-4 py-5">
          <h1 className="text-2xl font-bold">M-Pesa Payments</h1>
          <p className="text-sm text-green-100">Pay with M-Pesa STK Push and track your payments.</p>
        </div>
      </header>

      <nav className="mx-auto mt-6 flex max-w-4xl gap-2 overflow-x-auto px-4">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`whitespace-nowrap rounded-lg px-4 py-2 text-sm font-medium ${
              tab === id ? 'bg-green-600 text-white' : 'bg-white text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <main className="mx-auto max-w-4xl px-4 py-6">
        {tab === 'pay' && <PaymentFlow />}

        {tab === 'checkout' && (
          <div className="space-y-4">
            <p className="mx-auto max-w-md text-sm text-gray-600">
              Example checkout for a product with a set price, using the <code>fixedAmount</code> prop.
            </p>
            <PaymentFlow fixedAmount={1500} />
          </div>
        )}

        {/* Mounted only while the tab is open, so it fetches fresh data every time you open it. */}
        {tab === 'payments' && <PaymentsList />}
      </main>
    </div>
  );
}
