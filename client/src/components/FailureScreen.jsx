export default function FailureScreen({ message, onRetry }) {
  return (
    <div className="flex flex-col items-center text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-red-100">
        <svg className="h-9 w-9 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3} aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </div>
      <h2 className="mt-6 text-2xl font-bold text-gray-900">Payment Failed</h2>
      <p className="mt-2 text-gray-600">{message}</p>

      <button
        type="button"
        onClick={onRetry}
        className="mt-6 w-full rounded-lg bg-green-600 px-4 py-3 font-semibold text-white hover:bg-green-700"
      >
        Try Again
      </button>
    </div>
  );
}
