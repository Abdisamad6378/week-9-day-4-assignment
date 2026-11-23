import PaymentFlow from './components/PaymentFlow';

export default function App() {
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-green-700 text-white">
        <div className="mx-auto max-w-4xl px-4 py-5">
          <h1 className="text-2xl font-bold">M-Pesa Payments</h1>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <PaymentFlow />
      </main>
    </div>
  );
}
