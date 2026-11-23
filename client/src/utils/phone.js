// Kenyan phone number helpers for the payment form.
// formatPhoneNumber / isValidKenyanPhone are the same rules as server/phone.js (Day 2),
// so the browser and the server agree on what a valid number is.

// Returns { success: true, formatted: "2547XXXXXXXX" } or { success: false, error }.
export function formatPhoneNumber(phone) {
  if (phone === undefined || phone === null || String(phone).trim() === '') {
    return { success: false, error: 'Phone number is required.' };
  }

  const raw = String(phone).trim();
  if (!/^\+?[\d\s-]+$/.test(raw)) {
    return { success: false, error: 'Phone number must contain only digits, spaces, dashes, or a leading +.' };
  }

  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, '');

  if (digits.length < 10) return { success: false, error: 'Phone number too short.' };
  if (digits.length > 12) return { success: false, error: 'Phone number too long.' };
  if (hasPlus && !digits.startsWith('254')) {
    return { success: false, error: 'Invalid Kenyan phone number. Must start with 07, 01, or 254.' };
  }

  if (digits.length === 10 && /^0[17]/.test(digits)) {
    return { success: true, formatted: `254${digits.slice(1)}` };
  }
  if (digits.length === 12 && /^254[17]/.test(digits)) {
    return { success: true, formatted: digits };
  }
  return { success: false, error: 'Invalid Kenyan phone number. Must start with 07, 01, or 254.' };
}

export function isValidKenyanPhone(phone) {
  return formatPhoneNumber(phone).success;
}

// Formats what the user is typing, for display only.
//   "0712345678"    -> "0712 345 678"     (space after the 4th and 7th digit)
//   "254712345678"  -> "254 712 345 678"
//   "+254712345678" -> "+254 712 345 678"
// Anything that is not a digit (or a leading +) is dropped, and extra digits are cut off.
export function formatPhoneInput(value) {
  const hasPlus = value.trim().startsWith('+');
  let digits = value.replace(/\D/g, '');

  if (hasPlus || digits.startsWith('2')) {
    // International format: 254 + 9 digits
    digits = digits.slice(0, 12);
    const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 9), digits.slice(9, 12)];
    return (hasPlus ? '+' : '') + groups.filter(Boolean).join(' ');
  }

  // Local format: 07XX XXX XXX / 01XX XXX XXX
  digits = digits.slice(0, 10);
  const groups = [digits.slice(0, 4), digits.slice(4, 7), digits.slice(7, 10)];
  return groups.filter(Boolean).join(' ');
}

// "254712345678" (how the server stores it) -> "0712 345 678" (how people read it).
export function formatPhoneDisplay(phone) {
  const result = formatPhoneNumber(phone);
  if (!result.success) return String(phone ?? '');
  return formatPhoneInput(`0${result.formatted.slice(3)}`);
}

// "254712345678" -> "2547****5678": first 4 and last 4 digits, the middle hidden.
export function maskPhone(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '');
  if (digits.length < 8) return digits || '-';
  return `${digits.slice(0, 4)}****${digits.slice(-4)}`;
}
