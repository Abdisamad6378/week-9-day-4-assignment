// Money and date formatting shared by the payment screens and the payments list.

export const MIN_AMOUNT = 1;
export const MAX_AMOUNT = 150000; // Safaricom's per-transaction limit

// 1500 -> "KES 1,500"
export function formatKES(amount) {
  return `KES ${Number(amount).toLocaleString('en-US')}`;
}

// Returns an error message, or null when the amount is fine.
export function validateAmount(value) {
  if (value === '' || value === null || value === undefined) return 'Enter an amount.';
  const amount = Number(value);
  if (Number.isNaN(amount)) return 'Amount must be a number.';
  if (!Number.isInteger(amount)) return 'Amount must be a whole number of KES.';
  if (amount < MIN_AMOUNT) return `Minimum amount is ${formatKES(MIN_AMOUNT)}.`;
  if (amount > MAX_AMOUNT) return `Maximum amount is ${formatKES(MAX_AMOUNT)}.`;
  return null;
}

// "2026-05-04T11:30:00.000Z" -> "May 4, 2026 2:30 PM" (in the browser's time zone)
export function formatDateTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '-';
  const day = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  const time = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  return `${day} ${time}`;
}
