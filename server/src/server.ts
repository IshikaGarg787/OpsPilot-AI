import app from './app.js';
import { connectDatabase, databaseStatus } from './config/database.js';
import { env } from './config/env.js';
import { evaluateSlaRecords } from './services/slaManagementService.js';

const databaseConnected = await connectDatabase();
if (databaseConnected && process.env.NODE_ENV !== 'production') {
  const actor: any = await (await import('./models/User.js')).UserModel.findOne({ role: 'admin' }).select('_id').lean();
  if (actor) {
    const { seedDevelopmentSlaPolicies } = await import('./services/slaManagementService.js');
    await seedDevelopmentSlaPolicies(actor._id);
  }
}
if (env.runSlaScheduler) {
  const slaInterval = setInterval(() => { if (databaseStatus().connected) void evaluateSlaRecords().catch((error) => console.error('SLA evaluation failed:', error instanceof Error ? error.message : 'unknown error')); }, 60_000);
  slaInterval.unref();
}
app.listen(env.port, '0.0.0.0', () => {
  console.log(`OpsPilot API listening on http://localhost:${env.port}`);
});
