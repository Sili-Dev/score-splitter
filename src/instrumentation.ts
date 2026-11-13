const HOUR = 3600_000;

/** Runs once when the server starts. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;

  const { resumeUnfinishedJobs } = await import('@/lib/jobs/process');
  const { sweepExpiredJobs } = await import('@/lib/jobs/cleanup');

  const sweep = () => sweepExpiredJobs().catch((cause) => console.error('cleanup failed', cause));
  await sweep();
  setInterval(sweep, HOUR).unref();

  // Uploads that were being read when the server stopped carry on from where they were.
  void resumeUnfinishedJobs().catch((cause) => console.error('resume failed', cause));
}
