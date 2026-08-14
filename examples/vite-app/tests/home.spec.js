import { test, expect } from '@playwright/test';

test('primary CTA completes checkout', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Pay now' }).click();
  await expect(page).toHaveURL(/#confirmed/);
  await expect(page.locator('#status')).toHaveText(/Paid/);
});
