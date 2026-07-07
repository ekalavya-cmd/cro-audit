import { auditQueue } from '../modules/audit/queue/audit.queue.js';
import connectDB from '../config/mongodb.js';

async function checkQueue() {
  try {
    await connectDB();
    const active = await auditQueue.getJobs(['active']);
    const waiting = await auditQueue.getJobs(['waiting']);
    const completed = await auditQueue.getJobs(['completed']);
    const failed = await auditQueue.getJobs(['failed']);

    console.log(
      'Active:',
      active.map((j) => ({ id: j.id, data: j.data?.url })),
    );
    console.log(
      'Waiting:',
      waiting.map((j) => ({ id: j.id, data: j.data?.url })),
    );
    console.log('Completed count:', completed.length);
    console.log('Failed count:', failed.length);
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkQueue();
