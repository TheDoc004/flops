/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testTimeout: 30000,
  forceExit: true,
  testPathIgnorePatterns: ['/node_modules/', '/__tests__/helpers\\.js$'],
};
