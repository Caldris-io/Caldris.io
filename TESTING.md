# Testing Documentation

This document describes the testing infrastructure for the Caldris.io waitlist form.

## Overview

The project uses two types of tests:
- **Unit Tests** (Jest): Test individual form functions and logic
- **End-to-End Tests** (Playwright): Test the complete form workflow in real browsers

## Setup

### Install Dependencies

```bash
npm install
```

### Install Playwright Browsers

```bash
npm run playwright:install
```

## Running Tests

### Run All Tests

```bash
npm run test:all
```

### Unit Tests Only

```bash
# Run once
npm test

# Watch mode (re-runs on file changes)
npm run test:watch

# With coverage report
npm run test:coverage
```

### E2E Tests Only

```bash
# Run in headless mode
npm run test:e2e

# Run with UI (interactive mode)
npm run test:e2e:ui

# Run in headed mode (see browser)
npm run test:e2e:headed
```

## Test Structure

### Unit Tests (`src/waitlist-form.test.js`)

Tests the `WaitlistForm` class functionality:

#### Constructor and Initialization
- ✓ Initializes with correct form elements
- ✓ Has correct Formsubmit URL

#### Email Validation
- ✓ Validates correct email formats
- ✓ Rejects invalid email formats
- ✓ Handles empty emails

#### Button State Management
- ✓ Updates button text and disabled state
- ✓ Applies custom styles
- ✓ Resets button to original state

#### Form Data Building
- ✓ Builds correct FormData object
- ✓ Includes correct source (hero/cta)
- ✓ Includes valid ISO timestamp

#### Formsubmit Integration
- ✓ Submits form data to Formsubmit
- ✓ Throws error on failed submission

#### PostHog Analytics
- ✓ Identifies user and captures event
- ✓ Handles missing PostHog gracefully
- ✓ Includes correct source for each form

#### UI Feedback
- ✓ Shows success message and clears email
- ✓ Resets button after 3 seconds
- ✓ Shows error message on failure
- ✓ Resets button after 2 seconds

#### Form Submission
- ✓ Prevents default form submission
- ✓ Shows error for invalid email
- ✓ Successfully submits valid email
- ✓ Trims whitespace from email
- ✓ Shows error on submission failure
- ✓ Sets loading state during submission

#### Integration
- ✓ Completes full submission flow successfully
- ✓ Handles submission error gracefully

**Total: 30+ unit tests**

### E2E Tests (`tests/e2e/waitlist-form.spec.js`)

Tests the complete user experience across multiple browsers:

#### Form Elements
- ✓ Displays both waitlist forms (hero and CTA)
- ✓ Has email input with correct placeholder
- ✓ Has submit button with correct text

#### Email Validation
- ✓ Does not submit with empty email (HTML5 validation)
- ✓ Does not submit with invalid email format

#### Form Submission - Hero Form
- ✓ Shows loading state during submission
- ✓ Shows success state after successful submission
- ✓ Clears email field after submission
- ✓ Shows error state on submission failure
- ✓ Submits with correct form data

#### Form Submission - CTA Form
- ✓ Successfully submits from CTA form

#### PostHog Analytics
- ✓ Tracks form submission with PostHog
- ✓ Includes correct source for hero form
- ✓ Includes correct source for CTA form

#### Multiple Submissions
- ✓ Allows multiple submissions

#### Responsive Design
- ✓ Works on mobile viewport

**Total: 18+ E2E tests**

Tests run across multiple browsers:
- Chrome (Desktop)
- Firefox (Desktop)
- Safari (Desktop)
- Chrome (Mobile - Pixel 5)
- Safari (Mobile - iPhone 12)

## Test Coverage

Unit tests provide coverage for:
- ✅ Email validation logic
- ✅ Form data construction
- ✅ Formsubmit API integration
- ✅ PostHog analytics tracking
- ✅ Button state management
- ✅ Error handling
- ✅ Success/error feedback
- ✅ Timing and async operations

E2E tests verify:
- ✅ Real browser interaction
- ✅ HTML5 form validation
- ✅ Network request handling
- ✅ Visual feedback to users
- ✅ Cross-browser compatibility
- ✅ Mobile responsiveness
- ✅ Multiple form instances
- ✅ Analytics integration

## CI/CD Integration

These tests can be integrated into your CI/CD pipeline:

```yaml
# Example GitHub Actions
- name: Install dependencies
  run: npm install

- name: Install Playwright
  run: npm run playwright:install

- name: Run unit tests
  run: npm test

- name: Run E2E tests
  run: npm run test:e2e
```

## Mocking and Test Isolation

### Unit Tests
- `fetch` API is mocked to prevent real network calls
- PostHog is mocked to test analytics without sending data
- Timers are mocked to test time-based behavior

### E2E Tests
- Formsubmit requests are intercepted and mocked
- PostHog is mocked to verify tracking without sending data
- Each test runs in isolation with a fresh page

## Writing New Tests

### Adding Unit Tests

Add new test cases to `src/waitlist-form.test.js`:

```javascript
test('should do something', () => {
  // Arrange
  const email = 'test@example.com';

  // Act
  const result = waitlistForm.validateEmail(email);

  // Assert
  expect(result).toBe(true);
});
```

### Adding E2E Tests

Add new test cases to `tests/e2e/waitlist-form.spec.js`:

```javascript
test('should do something', async ({ page }) => {
  await page.goto('/');

  const form = page.locator('#waitlist-hero');
  await expect(form).toBeVisible();

  // Test interaction...
});
```

## Debugging Tests

### Debug Unit Tests

```bash
# Run specific test file
npm test -- waitlist-form.test.js

# Run specific test
npm test -- -t "should validate correct email formats"
```

### Debug E2E Tests

```bash
# Run with UI (best for debugging)
npm run test:e2e:ui

# Run specific test file
npx playwright test waitlist-form.spec.js

# Run specific test
npx playwright test -g "should show success state"

# Run in debug mode
npx playwright test --debug
```

### View Test Reports

After running E2E tests, view the HTML report:

```bash
npx playwright show-report
```

## Troubleshooting

### Unit Tests Failing

1. Clear Jest cache: `npx jest --clearCache`
2. Check that dependencies are installed: `npm install`
3. Verify mocks are properly set up in `jest.setup.js`

### E2E Tests Failing

1. Ensure Playwright browsers are installed: `npm run playwright:install`
2. Check that local server starts correctly (port 8080)
3. Try running in headed mode to see what's happening: `npm run test:e2e:headed`
4. Check test reports: `npx playwright show-report`

### Server Issues

If the web server doesn't start:

```bash
# Test manually
python3 -m http.server 8080

# Then in another terminal
npm run test:e2e
```

## Best Practices

1. **Keep tests independent**: Each test should work in isolation
2. **Use descriptive names**: Test names should clearly describe what they test
3. **Test user behavior**: Focus on how users interact with the form
4. **Mock external services**: Don't make real API calls in tests
5. **Test edge cases**: Invalid inputs, network errors, etc.
6. **Maintain test speed**: Fast tests = faster feedback

## Contributing

When adding new features to the form:

1. Write unit tests for new functions/methods
2. Add E2E tests for new user interactions
3. Run all tests before committing: `npm run test:all`
4. Ensure tests pass in CI/CD pipeline

## Resources

- [Jest Documentation](https://jestjs.io/)
- [Playwright Documentation](https://playwright.dev/)
- [Testing Best Practices](https://kentcdodds.com/blog/common-mistakes-with-react-testing-library)
