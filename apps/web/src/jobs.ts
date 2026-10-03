/**
 * Background jobs for the web process:
 * - TaifaPay reconciliation (safety net for missed webhooks), every 60 s
 * - SMS dispatch through the platform's Source Code account, every 20 s
 * - SMS credit top-ups (NAVAC TaifaPay), every 60 s
 * - expiry reminders, "we miss you", 19:00 staff summaries, every 15 min
 * - door PC (Site Bridge) offline / back online alerts, every 2 min
 * - NAVAC platform alerts (Source Code credit, door PCs down over 1 h), every 15 min
 * Quiet hours and the one-message-a-day limit are applied by the dispatcher, not here.
 */
export async function startJobs() {
  if (!process.env.DATABASE_URL || process.env.LANGO_DISABLE_JOBS) return;
  const {
    dispatchSms,
    platformAlerts,
    platformSms,
    queueDailySummaries,
    queueReminders,
    queueWinbacks,
    reconcileTaifaPay,
    reconcileSubscriptions,
    reconcileTopups,
    startTopup,
    watchBridges,
  } = await import('@lango/server');
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
    60_000,
    30_000,
    'sms top-ups',
    () => reconcileTopups(db(), (m) => console.warn(m)),
    (n) => `sms: credited ${n} top-up(s)`,
  );
  every(
    60_000,
    40_000,
    'subscription payments',
    () => reconcileSubscriptions(db(), (m) => console.warn(m)),
    (n) => `billing: ${n} subscription payment(s) confirmed`,
  );
  every(
    15 * 60_000,
    60_000,
    'sms reminders',
    async () => (await queueReminders(db(), portal)) + (await queueWinbacks(db())) + (await queueDailySummaries(db())),
    (n) => `sms: queued ${n} reminder / we-miss-you / summary message(s)`,
  );
  every(
    2 * 60_000,
    90_000,
    'bridge watch',
    () => watchBridges(db()),
    (n) => `sms: queued ${n} door PC alert(s)`,
  );
  every(
    15 * 60_000,
    120_000,
    'platform alerts',
    () => platformAlerts(db()),
    (n) => `sms: sent ${n} NAVAC alert(s)`,
  );
}
