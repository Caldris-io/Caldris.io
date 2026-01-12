// Mock fetch for testing
global.fetch = jest.fn();

// Mock PostHog
global.posthog = {
  identify: jest.fn(),
  capture: jest.fn()
};

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
  global.fetch.mockClear();

  // Recreate posthog mock if it was deleted
  if (!global.posthog) {
    global.posthog = {
      identify: jest.fn(),
      capture: jest.fn()
    };
  } else {
    global.posthog.identify.mockClear();
    global.posthog.capture.mockClear();
  }
});
