/** Background jobs for the web process: the TaifaPay reconciliation poller (safety net for missed webhooks). */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || !process.env.DATABASE_URL || process.env.LANGO_DISABLE_JOBS) return;
  const { reconcileTaifaPay } = await import('@lango/server');
  const { db } = await import('./server/db');
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const n = await reconcileTaifaPay(db(), (m) => console.warn(m));
      if (n) console.log(`taifapay reconcile: settled ${n} payment(s) the webhook had not delivered`);
    } catch (e) {
      console.error('taifapay reconcile failed', (e as Error).message);
    } finally {
      running = false;
    }
  };
  setInterval(tick, 60_000).unref();
  setTimeout(tick, 15_000).unref();
}
