/** Starts the background jobs (see jobs.ts) in the Node.js server only; the edge runtime never loads them. */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { startJobs } = await import('./jobs');
    await startJobs();
  }
}
