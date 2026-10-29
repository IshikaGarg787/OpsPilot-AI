import { Router } from 'express';
import { requireAdminOwner, requireAuth, requireRole } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/errorHandler.js';

const router = Router();
export const adminAuthorization = [requireAuth, requireRole('admin'), requireAdminOwner] as const;
router.use(...adminAuthorization);

router.get('/me', asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      admin: {
        id: req.user!._id.toString(),
        username: req.user!.username,
        role: req.user!.role,
      },
    },
  });
}));

export default router;
