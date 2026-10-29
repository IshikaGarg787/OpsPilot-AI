import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { asyncHandler, HttpError } from '../middleware/errorHandler.js';
import { PredictionModel } from '../models/Prediction.js';
import { databaseStatus } from '../config/database.js';
import { listModels } from '../services/modelRegistry.js';

const router = Router();
router.use(requireAuth);

function requireDatabase() {
  if (!databaseStatus().connected) throw new HttpError(503, 'Dashboard data is temporarily unavailable.', 'DATABASE_UNAVAILABLE');
}

const serialize = (prediction: any) => ({
  id: prediction._id.toString(),
  modelId: prediction.modelId,
  modelVersion: prediction.modelVersion,
  predictionType: prediction.predictionType,
  input: prediction.input,
  output: prediction.output,
  status: prediction.status,
  errorCode: prediction.errorCode,
  createdAt: prediction.createdAt,
});

router.get('/summary', asyncHandler(async (req, res) => {
  requireDatabase();
  const userId = req.user!._id;
  const [counts, average, models] = await Promise.all([
    PredictionModel.aggregate([{ $match: { userId } }, { $group: { _id: '$modelId', count: { $sum: 1 } } }]),
    PredictionModel.aggregate([{ $match: { userId, status: 'success' } }, { $group: { _id: null, value: { $avg: '$output.duration' } } }]),
    listModels(),
  ]);
  const totalPredictions = counts.reduce((sum, row) => sum + row.count, 0);
  const resolution = counts.filter((row) => ['resolution-time', 'triage-pipeline'].includes(row._id)).reduce((sum, row) => sum + row.count, 0);
  res.json({ success: true, data: { totalPredictions, resolutionPredictions: resolution, averageResolutionHours: average[0]?.value ?? null, availableModels: models.filter((model) => model.status === 'available').length, models } });
}));

router.get('/activity', asyncHandler(async (req, res) => {
  requireDatabase();
  const userId = req.user!._id;
  const [recent, daily, byPriority] = await Promise.all([
    PredictionModel.find({ userId }).sort({ createdAt: -1 }).limit(8).lean(),
    PredictionModel.aggregate([
      { $match: { userId, status: 'success', createdAt: { $gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } }, count: { $sum: 1 }, averageHours: { $avg: '$output.duration' } } },
      { $sort: { _id: 1 } },
    ]),
    PredictionModel.aggregate([{ $match: { userId, status: 'success', modelId: { $in: ['resolution-time', 'triage-pipeline'] } } }, { $group: { _id: '$input.priority', count: { $sum: 1 } } }, { $sort: { count: -1 } }]),
  ]);
  res.json({ success: true, data: { recent: recent.map(serialize), daily, byPriority } });
}));

export default router;
