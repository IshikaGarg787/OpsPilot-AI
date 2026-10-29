import mongoose, { type InferSchemaType } from 'mongoose';

const ticketAttachmentSchema = new mongoose.Schema({
  ticketId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ticket', required: true, index: true },
  uploadedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  fileName: { type: String, required: true, maxlength: 180 },
  mimeType: { type: String, required: true, enum: ['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'text/csv'] },
  size: { type: Number, required: true, min: 1, max: 3145728 },
  data: { type: Buffer, required: true, select: false },
}, { timestamps: true });

export type TicketAttachment = InferSchemaType<typeof ticketAttachmentSchema>;
export const TicketAttachmentModel = mongoose.models.TicketAttachment || mongoose.model<TicketAttachment>('TicketAttachment', ticketAttachmentSchema);
