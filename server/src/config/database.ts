import mongoose from 'mongoose';
import { env } from './env.js';

let connectionError: string | null = null;

export async function connectDatabase() {
  if (!env.mongodbUri) {
    connectionError = 'MONGODB_URI is not configured';
    console.warn(connectionError);
    return false;
  }

  try {
    await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 5000 });
    connectionError = null;
    console.log('MongoDB connected');
    return true;
  } catch {
    connectionError = 'MongoDB connection failed; verify database configuration and availability.';
    console.error('MongoDB connection failed (details redacted).');
    return false;
  }
}

export function databaseStatus() {
  return {
    connected: mongoose.connection.readyState === 1,
    state: mongoose.connection.readyState,
    error: connectionError,
  };
}
