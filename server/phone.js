// Kenyan phone number formatting for M-Pesa.
// Daraja only accepts 254XXXXXXXXX (12 digits, no plus), so everything is converted to that.

const ERRORS = {
  required: 'Phone number is required.',
  characters: 'Phone number must contain only digits, spaces, dashes, or a leading +.',
  tooShort: 'Phone number too short. Must be 10 digits (07XX) or 12 digits (254XX).',
  tooLong: 'Phone number too long. Must be 10 digits (07XX) or 12 digits (254XX).',
  badLength: 'Invalid phone number length. Must be 10 digits (07XX) or 12 digits (254XX).',
  prefix: 'Invalid Kenyan phone number. Must start with 07, 01, or 254.',
};

// Returns { success: true, formatted } or { success: false, error }. Never throws.
function formatPhoneNumber(phone) {
  if (phone === undefined || phone === null || String(phone).trim() === '') {
    return { success: false, error: ERRORS.required };
  }

  const raw = String(phone).trim();

  // Digits, spaces and dashes anywhere; a + only at the very start.
  if (!/^\+?[\d\s-]+$/.test(raw)) {
    return { success: false, error: ERRORS.characters };
  }

  const hasPlus = raw.startsWith('+');
  const digits = raw.replace(/\D/g, ''); // drop +, spaces and dashes

  if (digits.length < 10) return { success: false, error: ERRORS.tooShort };
  if (digits.length > 12) return { success: false, error: ERRORS.tooLong };

  // A + is only valid in front of the country code: +0712... is wrong.
  if (hasPlus && !digits.startsWith('254')) {
    return { success: false, error: ERRORS.prefix };
  }

  let formatted;
  if (digits.length === 10) {
    // 07XXXXXXXX or 01XXXXXXXX -> replace the leading 0 with 254
    if (!/^0[17]/.test(digits)) return { success: false, error: ERRORS.prefix };
    formatted = `254${digits.slice(1)}`;
  } else if (digits.length === 12) {
    // Already international, but the next digit must be 7 or 1 (Safaricom mobile ranges)
    if (!/^254[17]/.test(digits)) return { success: false, error: ERRORS.prefix };
    formatted = digits;
  } else {
    // 11 digits fits neither format
    return { success: false, error: ERRORS.badLength };
  }

  return { success: true, formatted };
}

function isValidKenyanPhone(phone) {
  return formatPhoneNumber(phone).success;
}

module.exports = { formatPhoneNumber, isValidKenyanPhone, PHONE_ERRORS: ERRORS };
