const { test, expect } = require('@playwright/test');

test.describe('Waitlist Form', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test.describe('Form Elements', () => {
    test('should display both waitlist forms', async ({ page }) => {
      const heroForm = page.locator('#waitlist-hero');
      const ctaForm = page.locator('#waitlist-cta');

      await expect(heroForm).toBeVisible();
      await expect(ctaForm).toBeVisible();
    });

    test('should have email input with correct placeholder', async ({ page }) => {
      const emailInput = page.locator('#waitlist-hero input[type="email"]');

      await expect(emailInput).toBeVisible();
      await expect(emailInput).toHaveAttribute('placeholder', 'you@company.com');
      await expect(emailInput).toHaveAttribute('required', '');
    });

    test('should have submit button with correct text', async ({ page }) => {
      const button = page.locator('#waitlist-hero button[type="submit"]');

      await expect(button).toBeVisible();
      await expect(button).toHaveText('Join Waitlist');
    });
  });

  test.describe('Email Validation', () => {
    test('should not submit with empty email', async ({ page }) => {
      const form = page.locator('#waitlist-hero');
      const button = form.locator('button[type="submit"]');

      await button.click();

      // HTML5 validation should prevent submission
      const emailInput = form.locator('input[type="email"]');
      const validationMessage = await emailInput.evaluate(el => el.validationMessage);
      expect(validationMessage).toBeTruthy();
    });

    test('should not submit with invalid email format', async ({ page }) => {
      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await emailInput.fill('invalid-email');
      await button.click();

      // HTML5 validation should catch invalid format
      const validationMessage = await emailInput.evaluate(el => el.validationMessage);
      expect(validationMessage).toContain('@');
    });
  });

  test.describe('Form Submission - Hero Form', () => {
    test('should show loading state during submission', async ({ page }) => {
      // Intercept the fetch request to control timing
      await page.route('https://formsubmit.co/**', async route => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        await route.fulfill({
          status: 200,
          body: 'OK'
        });
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await emailInput.fill('test@example.com');
      await button.click();

      // Check loading state
      await expect(button).toHaveText('Joining...');
      await expect(button).toBeDisabled();
    });

    test('should show success state after successful submission', async ({ page }) => {
      // Mock successful submission
      await page.route('https://formsubmit.co/**', async route => {
        await route.fulfill({
          status: 200,
          body: 'OK'
        });
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await emailInput.fill('test@example.com');
      await button.click();

      // Wait for success state
      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });
      await expect(button).toBeDisabled();

      // Email should be cleared
      await expect(emailInput).toHaveValue('');

      // Button should reset after 3 seconds
      await expect(button).toHaveText('Join Waitlist', { timeout: 4000 });
      await expect(button).toBeEnabled();
    });

    test('should clear email field after successful submission', async ({ page }) => {
      await page.route('https://formsubmit.co/**', async route => {
        await route.fulfill({ status: 200, body: 'OK' });
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await emailInput.fill('test@example.com');
      await button.click();

      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });
      await expect(emailInput).toHaveValue('');
    });

    test('should show error state on submission failure', async ({ page }) => {
      // Mock failed submission
      await page.route('https://formsubmit.co/**', async route => {
        await route.abort('failed');
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await emailInput.fill('test@example.com');
      await button.click();

      // Wait for error state
      await expect(button).toHaveText('Error - Try again', { timeout: 5000 });
      await expect(button).toBeEnabled();

      // Button should reset after 2 seconds
      await expect(button).toHaveText('Join Waitlist', { timeout: 3000 });
    });

    test('should submit with correct form data', async ({ page }) => {
      let capturedRequest;

      await page.route('https://formsubmit.co/**', async (route, request) => {
        capturedRequest = request;
        await route.fulfill({ status: 200, body: 'OK' });
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await emailInput.fill('user@company.com');
      await button.click();

      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });

      // Verify request was made
      expect(capturedRequest).toBeDefined();
      expect(capturedRequest.method()).toBe('POST');
      expect(capturedRequest.url()).toContain('formsubmit.co');
    });
  });

  test.describe('Form Submission - CTA Form', () => {
    test('should successfully submit from CTA form', async ({ page }) => {
      await page.route('https://formsubmit.co/**', async route => {
        await route.fulfill({ status: 200, body: 'OK' });
      });

      // Scroll to CTA form
      const ctaForm = page.locator('#waitlist-cta');
      await ctaForm.scrollIntoViewIfNeeded();

      const emailInput = ctaForm.locator('input[type="email"]');
      const button = ctaForm.locator('button[type="submit"]');

      await emailInput.fill('cta-test@example.com');
      await button.click();

      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });
      await expect(emailInput).toHaveValue('');
    });
  });

  test.describe('PostHog Analytics', () => {
    test('should track form submission with PostHog', async ({ page }) => {
      let posthogCalls = [];

      // Mock PostHog
      await page.addInitScript(() => {
        window.posthog = {
          identify: (...args) => {
            window.posthogCalls = window.posthogCalls || [];
            window.posthogCalls.push({ method: 'identify', args });
          },
          capture: (...args) => {
            window.posthogCalls = window.posthogCalls || [];
            window.posthogCalls.push({ method: 'capture', args });
          }
        };
        window.posthogCalls = [];
      });

      await page.route('https://formsubmit.co/**', async route => {
        await route.fulfill({ status: 200, body: 'OK' });
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await emailInput.fill('analytics@example.com');
      await button.click();

      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });

      // Check PostHog was called
      posthogCalls = await page.evaluate(() => window.posthogCalls);

      expect(posthogCalls.length).toBeGreaterThan(0);

      const identifyCall = posthogCalls.find(call => call.method === 'identify');
      expect(identifyCall).toBeDefined();
      expect(identifyCall.args[0]).toBe('analytics@example.com');

      const captureCall = posthogCalls.find(call => call.method === 'capture');
      expect(captureCall).toBeDefined();
      expect(captureCall.args[0]).toBe('waitlist_joined');
    });

    test('should include correct source in analytics for hero form', async ({ page }) => {
      await page.addInitScript(() => {
        window.posthog = {
          identify: () => {},
          capture: (...args) => {
            window.lastCaptureArgs = args;
          }
        };
      });

      await page.route('https://formsubmit.co/**', async route => {
        await route.fulfill({ status: 200, body: 'OK' });
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await emailInput.fill('test@example.com');
      await button.click();

      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });

      const captureArgs = await page.evaluate(() => window.lastCaptureArgs);
      expect(captureArgs[1].signup_source).toBe('hero');
    });

    test('should include correct source in analytics for CTA form', async ({ page }) => {
      await page.addInitScript(() => {
        window.posthog = {
          identify: () => {},
          capture: (...args) => {
            window.lastCaptureArgs = args;
          }
        };
      });

      await page.route('https://formsubmit.co/**', async route => {
        await route.fulfill({ status: 200, body: 'OK' });
      });

      const ctaForm = page.locator('#waitlist-cta');
      await ctaForm.scrollIntoViewIfNeeded();

      const emailInput = ctaForm.locator('input[type="email"]');
      const button = ctaForm.locator('button[type="submit"]');

      await emailInput.fill('cta@example.com');
      await button.click();

      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });

      const captureArgs = await page.evaluate(() => window.lastCaptureArgs);
      expect(captureArgs[1].signup_source).toBe('cta');
    });
  });

  test.describe('Multiple Submissions', () => {
    test('should allow multiple submissions', async ({ page }) => {
      await page.route('https://formsubmit.co/**', async route => {
        await route.fulfill({ status: 200, body: 'OK' });
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      // First submission
      await emailInput.fill('first@example.com');
      await button.click();
      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });
      await expect(button).toHaveText('Join Waitlist', { timeout: 4000 });

      // Second submission
      await emailInput.fill('second@example.com');
      await button.click();
      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });
    });
  });

  test.describe('Responsive Design', () => {
    test('should work on mobile viewport', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });

      await page.route('https://formsubmit.co/**', async route => {
        await route.fulfill({ status: 200, body: 'OK' });
      });

      const form = page.locator('#waitlist-hero');
      const emailInput = form.locator('input[type="email"]');
      const button = form.locator('button[type="submit"]');

      await expect(form).toBeVisible();
      await emailInput.fill('mobile@example.com');
      await button.click();

      await expect(button).toHaveText('You\'re in!', { timeout: 5000 });
    });
  });
});
