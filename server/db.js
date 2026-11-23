// One shared Prisma client for the whole app.
// Prisma 7 talks to Postgres through a driver adapter (@prisma/adapter-pg).
require('dotenv').config({ quiet: true });
const { PrismaClient } = require('./generated/prisma');
const { PrismaPg } = require('@prisma/adapter-pg');

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

module.exports = prisma;
