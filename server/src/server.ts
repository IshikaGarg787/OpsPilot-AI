import app from './app.js';
import { connectDatabase, databaseStatus } from './config/database.js';
import { env } from './config/env.js';
import { evaluateSlaRecords } from './services/slaManagementService.js';

app.listen(env.port, '0.0.0.0', () => {
  console.log(`OpsPilot API listening on http://localhost:${env.port}`);
});

// Bind the API before database setup so liveness checks and requests can receive
// a response even when MongoDB or optional development seeding is slow.
void initializeDatabase();

async function initializeDatabase() {
  const databaseConnected = await connectDatabase();
  if (databaseConnected && process.env.NODE_ENV !== 'production') {
    try {
      const actor: any = await (await import('./models/User.js')).UserModel.findOne({ role: 'admin' }).select('_id').lean();
      if (actor) {
        const { seedDevelopmentSlaPolicies } = await import('./services/slaManagementService.js');
        await seedDevelopmentSlaPolicies(actor._id);
      }
    } catch (error) {
      console.error('Development SLA policy setup failed:', error instanceof Error ? error.message : 'unknown error');
    }
  }

  if (env.runSlaScheduler) {
    const slaInterval = setInterval(() => {
      if (databaseStatus().connected) void evaluateSlaRecords().catch((error) => console.error('SLA evaluation failed:', error instanceof Error ? error.message : 'unknown error'));
    }, 60_000);
    slaInterval.unref();
  }
}
