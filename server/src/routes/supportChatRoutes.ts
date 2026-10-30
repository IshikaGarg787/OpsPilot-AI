import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { normalizedRole } from '../models/User.js';
import { answerSupportChat } from '../services/supportChatService.js';

const router = Router();
const chatSchema = z.object({
  messages: z.array(z.object({
    role: z.enum(['user', 'assistant']),
    content: z.string().trim().min(1).max(2000),
  }).strict()).min(1).max(12),
}).strict().refine((body) => body.messages.at(-1)?.role === 'user', 'The latest chat message must be from the user.');

const chatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 12,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { success: false, message: 'Please wait a moment before sending another message.', code: 'CHAT_RATE_LIMITED' },
});

router.use(requireAuth, requireRole('customer', 'it_team'));

router.post('/', chatLimiter, asyncHandler(async (req, res) => {
  const input = chatSchema.parse(req.body);
  const role = normalizedRole(req.user!);
  if (role !== 'customer' && role !== 'it_team') throw new HttpError(403, 'Support chat is available to Customers and IT Team members.', 'CHAT_ROLE_NOT_ALLOWED');
  const result = await answerSupportChat({ messages: input.messages, role, userId: req.user!._id });
  res.json({ success: true, data: result, message: result.mode === 'local_model' ? 'Local Ollama response generated.' : result.mode === 'static_data' ? 'Answered from help and ticket records.' : 'Retrieved support guidance.' });
}));

export default router;
