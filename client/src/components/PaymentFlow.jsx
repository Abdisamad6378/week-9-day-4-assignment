import { useState } from 'react';
import PaymentForm from './PaymentForm';
import ProcessingScreen from './ProcessingScreen';
import SuccessScreen from './SuccessScreen';
import FailureScreen from './FailureScreen';
import { formatPhoneDisplay } from '../utils/phone';

// The whole payment journey:
//   form -> [submit] -> processing (poll every 3 s) -> success | failed
export default function PaymentFlow({ fixedAmount }) {
  const [step, setStep] = useState('form'); // 'form' | 'processing' | 'success' | 'failed'
  const [payment, setPayment] = useState(null); // { paymentId, phoneNumber, amount, ... }
  const [failureMessage, setFailureMessage] = useState('');
  const [formValues, setFormValues] = useState({ phone: '', amount: '' });
  const [formKey, setFormKey] = useState(0); // a new key gives a fresh, empty form

  function handlePaymentStarted(started) {
    setPayment(started);
    setStep('processing');
  }

  function handleResult(result) {
    if (result.status === 'completed') {
      // The callback may have the real amount/phone from Safaricom: prefer those.
      setPayment((current) => ({ ...current, ...result.payment }));
      setStep('success');
    } else {
      setFailureMessage(result.message);
      setStep('failed');
    }
  }

  // Back to the form, keeping what was typed (Cancel and Try Again).
  function backToForm() {
    setFormValues({ phone: payment?.phoneNumber ?? '', amount: payment?.amount ?? '' });
    setFormKey((key) => key + 1);
    setStep('form');
  }

  // Back to an empty form (Make Another Payment).
  function startOver() {
    setPayment(null);
    setFormValues({ phone: '', amount: '' });
    setFormKey((key) => key + 1);
    setStep('form');
  }

  return (
    <div className="mx-auto w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-gray-200 sm:p-8">
      {step === 'form' && (
        <>
          <h2 className="mb-6 text-xl font-bold text-gray-900">Pay with M-Pesa</h2>
          <PaymentForm
            key={formKey}
            fixedAmount={fixedAmount}
            initialPhone={formValues.phone ? formatPhoneDisplay(formValues.phone) : ''}
            initialAmount={formValues.amount}
            onPaymentStarted={handlePaymentStarted}
          />
        </>
      )}

      {step === 'processing' && <ProcessingScreen payment={payment} onResult={handleResult} onCancel={backToForm} />}

      {step === 'success' && <SuccessScreen payment={payment} onReset={startOver} />}

      {step === 'failed' && <FailureScreen message={failureMessage} onRetry={backToForm} />}
    </div>
  );
}

