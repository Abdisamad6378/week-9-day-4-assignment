// M-Pesa configuration: reads everything from environment variables,
// checks nothing is missing, and builds the values the rest of the app needs.

const REQUIRED_VARS = [
  'MPESA_CONSUMER_KEY',
  'MPESA_CONSUMER_SECRET',
  'MPESA_SHORTCODE',
  'MPESA_PASSKEY',
  'MPESA_ENV',
  'MPESA_CALLBACK_URL',
];

const BASE_URLS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

// Read the values fresh each time so changes to process.env (for example in tests) are picked up.
function getConfig() {
  return {
    consumerKey: process.env.MPESA_CONSUMER_KEY,
    consumerSecret: process.env.MPESA_CONSUMER_SECRET,
    shortcode: process.env.MPESA_SHORTCODE,
    passkey: process.env.MPESA_PASSKEY,
    environment: process.env.MPESA_ENV,
    callbackUrl: process.env.MPESA_CALLBACK_URL,
  };
}

let productionWarningShown = false;

// Throws if any required variable is missing or only whitespace.
// Returns the config object when everything is present.
function validateConfig() {
  const missing = REQUIRED_VARS.filter((name) => {
    const value = process.env[name];
    return value === undefined || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  const config = getConfig();

  if (config.environment === 'production' && !productionWarningShown) {
    console.warn('WARNING: Running in PRODUCTION mode. Real money will move.');
    productionWarningShown = true;
  }

  return config;
}

// Anything other than "production" falls back to the sandbox, so a typo never hits live M-Pesa.
function getBaseUrl() {
  return process.env.MPESA_ENV === 'production' ? BASE_URLS.production : BASE_URLS.sandbox;
}

// "key:secret" encoded as Base64, used in the Basic auth header for the OAuth request.
function getBase64Credentials() {
  const { consumerKey, consumerSecret } = getConfig();
  if (!consumerKey || !consumerSecret) {
    throw new Error('Missing M-Pesa credentials: set MPESA_CONSUMER_KEY and MPESA_CONSUMER_SECRET');
  }
  return Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
}

module.exports = {
  REQUIRED_VARS,
  getConfig,
  validateConfig,
  getBaseUrl,
  getBase64Credentials,
};
