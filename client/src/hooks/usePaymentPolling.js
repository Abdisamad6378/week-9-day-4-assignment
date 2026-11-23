import { useEffect, useRef, useState } from 'react';
import { pollPayment } from '../api/payments';

export const POLL_INTERVAL_MS = 3000; // ask every 3 seconds
export const MAX_POLLS = 40; // 40 x 3 s = 2 minutes
export const TIMEOUT_MESSAGE = 'Payment request timed out. Please try again.';

const FAILED_STATUSES = ['failed', 'cancelled'];

// Polls GET /api/payments/:id/poll until the payment is no longer "pending".
// Calls onResult once with one of:
//   { status: 'completed', payment }
//   { status: 'failed' | 'cancelled', payment, message }
//   { status: 'timeout', message }
// Returns how many polls have been made so far (for the "checking..." text).
export function usePaymentPolling(paymentId, onResult) {
  const [pollCount, setPollCount] = useState(0);

  // Keep the latest onResult in a ref, so a new function from the parent on every
  // render does not restart the interval.
  const onResultRef = useRef(onResult);
  useEffect(() => {
    onResultRef.current = onResult;
  });

  useEffect(() => {
    if (!paymentId) return undefined;

    let polls = 0;
    let stopped = false; // set by finish() or by the cleanup below
    let waiting = false; // a request is still on its way

    const finish = (result) => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      onResultRef.current(result);
    };

    const timer = setInterval(async () => {
      if (stopped) return;
      // Every tick counts, even one we skip, so the 2-minute limit holds even if
      // a request hangs.
      polls += 1;
      setPollCount(polls);
      const isLastPoll = polls >= MAX_POLLS;

      // If the last request is still on its way, don't send a second one this tick.
      if (waiting) {
        if (isLastPoll) finish({ status: 'timeout', message: TIMEOUT_MESSAGE });
        return;
      }
      waiting = true;

      try {
        const payment = await pollPayment(paymentId);
        if (stopped) return; // the user left the screen while we were waiting

        if (payment.status === 'completed') {
          finish({ status: 'completed', payment });
          return;
        }
        if (FAILED_STATUSES.includes(payment.status)) {
          finish({
            status: payment.status,
            payment,
            message: payment.resultDesc || 'The payment was not completed.',
          });
          return;
        }
      } catch (error) {
        // A network blip should not end the payment: try again on the next tick.
        console.warn(`Poll ${polls} failed: ${error.message}`);
      } finally {
        waiting = false;
      }

      if (isLastPoll) finish({ status: 'timeout', message: TIMEOUT_MESSAGE });
    }, POLL_INTERVAL_MS);

    // Cleanup: runs when the screen unmounts (Cancel, success, failure) or paymentId changes.
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [paymentId]);

  return pollCount;
}
