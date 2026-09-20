process.env.DISCORD_TOKEN ??= 'test-token';
process.env.DISCORD_CLIENT_ID ??= 'test-client-id';
// Relative Pfade werden von Prisma relativ zu prisma/schema.prisma aufgeloest.
process.env.DATABASE_URL ??= 'file:./test.db';
process.env.NODE_ENV ??= 'test';
process.env.LOG_LEVEL ??= 'silent';
