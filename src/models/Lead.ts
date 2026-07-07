import mongoose, { Schema, Document } from 'mongoose';

export interface ILead extends Document {
  email: string;
  websiteUrl: string;
  mode: 'seo' | 'uxui' | 'full';
  auditResult?: Record<string, unknown>;
  status: 'pending' | 'completed' | 'failed';
  jobId: string;
  createdAt: Date;
  updatedAt: Date;
}

const LeadSchema = new Schema<ILead>(
  {
    email: { type: String, required: true },
    websiteUrl: { type: String, required: true },
    mode: { type: String, enum: ['seo', 'uxui', 'full'], default: 'full' },
    auditResult: { type: Schema.Types.Mixed },
    status: { type: String, enum: ['pending', 'completed', 'failed'], default: 'pending' },
    jobId: { type: String, required: true },
  },
  {
    timestamps: true,
    collection: 'cro_leads',
  },
);

export const Lead = mongoose.model<ILead>('Lead', LeadSchema);
