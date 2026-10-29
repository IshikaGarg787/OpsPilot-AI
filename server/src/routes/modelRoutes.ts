import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { MlServiceError } from '../services/mlService.js';
import { getModel, getResolutionMetadata, listModels } from '../services/modelRegistry.js';

const router = Router();
router.use(requireAuth);

router.get('/', asyncHandler(async (_req, res) => {
  res.json({ success: true, data: { models: await listModels() } });
}));

router.get('/:modelId/metadata', asyncHandler(async (req, res) => {
  if (String(req.params.modelId) !== 'resolution-time') throw new HttpError(404, 'Metadata is not available for this model.', 'MODEL_METADATA_NOT_FOUND');
  try {
    res.json({ success: true, data: await getResolutionMetadata() });
  } catch (error) {
    if (error instanceof MlServiceError) throw new HttpError(error.status, error.message, error.code);
    throw error;
  }
}));

router.get('/:modelId', asyncHandler(async (req, res) => {
  const model = await getModel(String(req.params.modelId));
  if (!model) throw new HttpError(404, 'Model not found.', 'MODEL_NOT_FOUND');
  res.json({ success: true, data: { model } });
}));

export default router;
