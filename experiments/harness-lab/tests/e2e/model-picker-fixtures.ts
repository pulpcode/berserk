import { expect, type Page, type Locator } from '@playwright/test';

export async function selectChatModel(page: Page, modelId: string, scope: Page | Locator = page) {
  const trigger = scope.getByRole('button', { name: '选择模型', exact: true });
  await trigger.click();
  await page.getByRole('dialog', { name: '选择模型', exact: true }).locator(`[data-model-choice="${modelId}"]`).click();
  await expect(trigger).toHaveAttribute('data-model-id', modelId);
}
