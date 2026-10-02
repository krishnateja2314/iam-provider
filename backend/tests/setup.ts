// Test setup - configures environment variables for tests
import dotenv from 'dotenv';
dotenv.config();

// Override for test environment
process.env.NODE_ENV = 'test';
process.env.JWT_ISSUER = 'http://localhost:8180/realms/iam-platform';
process.env.JWT_AUDIENCE = 'iam-backend';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://iam_user:dev_password_change_me@localhost:5432/iam_platform';
