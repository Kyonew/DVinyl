/**
 * Database URL for one integration test file.
 *
 * The integration tests drop the database they run on, so TEST_MONGODB_URL has to name a
 * throwaway one (dvinyl_<something>_test), never a real instance. node --test runs the
 * files in parallel, so each file then works on a database of its own on that server.
 * Returns '' when TEST_MONGODB_URL is unset (the test skips) and throws when it names
 * anything else.
 */
export function integrationDbUrl(databaseName: string): string {
  const raw = process.env.TEST_MONGODB_URL || '';
  if (!raw) return '';
  const match = raw.match(/^(mongodb(?:\+srv)?:\/\/[^/]+\/)([^?]*)(\?.*)?$/);
  if (!match || !/^dvinyl_[a-z0-9_]+_test$/.test(match[2]!)) {
    throw new Error('TEST_MONGODB_URL must name a throwaway database such as dvinyl_integration_test');
  }
  return `${match[1]}${databaseName}${match[3] || ''}`;
}
