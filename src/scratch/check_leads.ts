import { Lead } from '../models/Lead.js';
import connectDB from '../config/mongodb.js';

async function checkLeads() {
  try {
    await connectDB();
    const leads = await Lead.find().sort({ createdAt: -1 }).limit(5);
    console.log(
      'Leads:',
      leads.map((l) => ({
        id: l._id,
        url: l.websiteUrl,
        status: l.status,
        jobId: l.jobId,
        createdAt: l.createdAt,
      })),
    );
  } catch (err) {
    console.error(err);
  } finally {
    process.exit(0);
  }
}

checkLeads();
