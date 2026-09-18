const { test, expect } = require('@playwright/test');

test('publishes complete Open Graph metadata', async ({ page }) => {
  await page.goto('/');

  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute('content', 'website');
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    'content',
    'Caldris — Compliance-Ready Audit Trails for AI Agents'
  );
  await expect(page.locator('meta[property="og:description"]')).toHaveAttribute(
    'content',
    'Prove Zero Trust to your auditor. Immutable logs that map to SOC 2, HIPAA, and more.'
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute('content', 'https://caldris.io/');
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    'content',
    'https://caldris.io/caldris_icon.png'
  );
});
