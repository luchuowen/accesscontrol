/**
 * Background jobs for the web process:
 * - TaifaPay reconciliation (safety net for missed webhooks), every 60 s
 * - SMS dispatch through the platform's Source Code account, every 20 s
 * - SMS credit top-ups (NAVAC TaifaPay), every 60 s
 * - expiry reminders, every 15 min
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.DATABASE_URL || process.env.LANGO_DISABLE_JOBS) return;
  const { dispatchSms, platformSms, queueReminders, reconcileTaifaPay, reconcileTopups, startTopup } = await import(
    '@lango/server'
  );
  const { db } = await import('./server/db');
  const portal = (process.env.PUBLIC_URL ?? '').replace(/\/$/, '');
  const every = (ms: number, first: number, name: string, job: () => Promise<number>, done: (n: number) => string) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const n = await job();
        if (n) console.log(done(n));
      } catch (e) {
        console.error(`${name} failed`, (e as Error).message);
      } finally {
        running = false;
      }
    };
    setInterval(tick, ms).unref();
    setTimeout(tick, first).unref();
  };
  every(
    60_000,
    15_000,
    'taifapay reconcile',
    () => reconcileTaifaPay(db(), (m) => console.warn(m)),
    (n) => `taifapay reconcile: settled ${n} payment(s) the webhook had not delivered`,
  );
  every(
    20_000,
    10_000,
    'sms dispatch',
    async () => {
      const client = await platformSms(db());
      if (!client) return 0;
      return dispatchSms(
        db(),
        client,
        (m) => console.warn(m),
        async (tenantId, _balance, n) => {
          // The club chose automatic top-up: prompt their phone for NAVAC SMS credit (one prompt per hour at most).
          if (n.autoTopup && n.alertPhone)
            await startTopup(db(), tenantId, {
              amountKes: n.autoTopupKes ?? 1000,
              phone: n.alertPhone,
              trigger: 'auto',
              actor: 'system',
            });
        },
      );
    },
    (n) => `sms: sent ${n}`,
  );
  every(
    15 * 60_000,
    60_000,
    'sms reminders',
    () => queueReminders(db(), portal),
    (n) => `sms: queued ${n} reminder(s)`,
  );
}
