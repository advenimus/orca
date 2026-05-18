/**
 * E2E tests for the browser tab: creating browser tabs and state retention.
 *
 * User Prompt:
 * - Browser works and also retains state when switching tabs etc.
 */

import { test, expect } from './helpers/orca-app'
import type { Page } from '@stablyai/playwright-test'
import { rmSync } from 'node:fs'
import {
  createHttpFixturePage,
  createLocalBrowserFixture,
  executeInBrowserGuest,
  getBrowserGuestUrl
} from './helpers/browser-guest-fixtures'
import {
  waitForSessionReady,
  waitForActiveWorktree,
  getActiveWorktreeId,
  getActiveTabType,
  getBrowserTabs,
  getAllWorktreeIds,
  switchToOtherWorktree,
  switchToWorktree,
  ensureTerminalVisible
} from './helpers/store'

async function createBrowserTab(page: Page, worktreeId: string, url?: string): Promise<void> {
  await page.evaluate(
    ({ targetWorktreeId, targetUrl }) => {
      const store = window.__store
      if (!store) {
        return
      }

      const state = store.getState()
      state.createBrowserTab(
        targetWorktreeId,
        targetUrl ?? state.browserDefaultUrl ?? 'about:blank',
        {
          title: 'New Browser Tab',
          activate: true
        }
      )
    },
    { targetWorktreeId: worktreeId, targetUrl: url }
  )
}

async function switchToTerminalTab(
  page: Parameters<typeof getActiveWorktreeId>[0],
  worktreeId: string
): Promise<void> {
  await page.evaluate((targetWorktreeId) => {
    const store = window.__store
    if (!store) {
      return
    }

    const state = store.getState()
    const terminalTab = (state.tabsByWorktree[targetWorktreeId] ?? [])[0]
    if (terminalTab) {
      state.setActiveTab(terminalTab.id)
    }
    state.setActiveTabType('terminal')
  }, worktreeId)
}

async function switchToBrowserTab(
  page: Parameters<typeof getActiveWorktreeId>[0],
  worktreeId: string,
  browserTabId: string
): Promise<void> {
  await page.evaluate(
    ({ targetWorktreeId, targetBrowserTabId }) => {
      const store = window.__store
      if (!store) {
        return
      }

      const state = store.getState()
      if (
        (state.browserTabsByWorktree[targetWorktreeId] ?? []).some(
          (tab) => tab.id === targetBrowserTabId
        )
      ) {
        state.setActiveBrowserTab(targetBrowserTabId)
      }
    },
    { targetWorktreeId: worktreeId, targetBrowserTabId: browserTabId }
  )
}

test.describe('Browser Tab', () => {
  test.beforeEach(async ({ orcaPage }) => {
    await waitForSessionReady(orcaPage)
    await waitForActiveWorktree(orcaPage)
    await ensureTerminalVisible(orcaPage)
  })

  /**
   * User Prompt:
   * - Browser works and also retains state when switching tabs etc.
   */
  test('creating a browser tab adds it and activates browser view', async ({ orcaPage }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!
    const browserTabsBefore = await getBrowserTabs(orcaPage, worktreeId)

    await createBrowserTab(orcaPage, worktreeId)

    // Wait for the browser tab to appear in the store
    await expect
      .poll(async () => (await getBrowserTabs(orcaPage, worktreeId)).length, { timeout: 5_000 })
      .toBe(browserTabsBefore.length + 1)

    // The active tab type should switch to 'browser'
    await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 3_000 }).toBe('browser')
  })

  /**
   * User Prompt:
   * - Browser works and also retains state when switching tabs etc.
   */
  test('browser tab is created and active in the store', async ({ orcaPage }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    await createBrowserTab(orcaPage, worktreeId)
    await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 5_000 }).toBe('browser')

    // Verify the browser tab exists in the store
    const browserTabs = await getBrowserTabs(orcaPage, worktreeId)
    expect(browserTabs.length).toBeGreaterThan(0)

    // The active browser tab should have a URL (even if it's about:blank or the default)
    const activeBrowserTabId = await orcaPage.evaluate(() => {
      const store = window.__store
      return store?.getState().activeBrowserTabId ?? null
    })
    expect(activeBrowserTabId).not.toBeNull()
  })

  /**
   * User Prompt:
   * - Browser works and also retains state when switching tabs etc.
   */
  test('browser tab retains state when switching to terminal and back', async ({ orcaPage }) => {
    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    await createBrowserTab(orcaPage, worktreeId)
    await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 5_000 }).toBe('browser')

    // Record the browser tab info
    const browserTabsBefore = await getBrowserTabs(orcaPage, worktreeId)
    expect(browserTabsBefore.length).toBeGreaterThan(0)
    const browserTabId = browserTabsBefore.at(-1)?.id
    expect(browserTabId).toBeTruthy()

    // Switch to the terminal view
    await switchToTerminalTab(orcaPage, worktreeId)
    await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 3_000 }).toBe('terminal')

    // Switch back to browser tab
    await switchToBrowserTab(orcaPage, worktreeId, browserTabId!)
    await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 3_000 }).toBe('browser')

    // The browser tab should still exist with the same ID
    const browserTabsAfter = await getBrowserTabs(orcaPage, worktreeId)
    const tabStillExists = browserTabsAfter.some((tab) => tab.id === browserTabId)
    expect(tabStillExists).toBe(true)
  })

  /**
   * User Prompt:
   * - Browser works and also retains state when switching tabs etc.
   */
  test('browser tab retains state when switching worktrees and back', async ({ orcaPage }) => {
    const allWorktreeIds = await getAllWorktreeIds(orcaPage)
    if (allWorktreeIds.length < 2) {
      test.skip(true, 'Need at least 2 worktrees to test worktree switching')
    }

    const worktreeId = (await getActiveWorktreeId(orcaPage))!

    await createBrowserTab(orcaPage, worktreeId)
    await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 5_000 }).toBe('browser')

    const browserTabsBefore = await getBrowserTabs(orcaPage, worktreeId)
    expect(browserTabsBefore.length).toBeGreaterThan(0)

    // Switch to a different worktree via the store
    const otherId = await switchToOtherWorktree(orcaPage, worktreeId)
    expect(otherId).not.toBeNull()
    await expect.poll(async () => getActiveWorktreeId(orcaPage), { timeout: 5_000 }).toBe(otherId)

    // Switch back to the original worktree
    await switchToWorktree(orcaPage, worktreeId)
    await expect
      .poll(async () => getActiveWorktreeId(orcaPage), { timeout: 5_000 })
      .toBe(worktreeId)

    // Browser tabs should still be preserved
    const browserTabsAfter = await getBrowserTabs(orcaPage, worktreeId)
    expect(browserTabsAfter.length).toBe(browserTabsBefore.length)
  })

  test('local file preview links navigate inside the embedded browser', async ({
    electronApp,
    orcaPage
  }) => {
    const fixture = createLocalBrowserFixture()
    try {
      const worktreeId = (await getActiveWorktreeId(orcaPage))!

      await createBrowserTab(orcaPage, worktreeId, fixture.indexUrl)
      await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 5_000 }).toBe('browser')

      await expect
        .poll(async () => getBrowserGuestUrl(electronApp, orcaPage), {
          timeout: 10_000,
          message: 'Browser guest did not load the local index page'
        })
        .toBe(fixture.indexUrl)

      await executeInBrowserGuest<void>(
        electronApp,
        orcaPage,
        `document.querySelector('#go')?.click()`
      )

      await expect
        .poll(async () => getBrowserGuestUrl(electronApp, orcaPage), {
          timeout: 10_000,
          message: 'Clicking a local preview link did not navigate to the linked file'
        })
        .toBe(fixture.targetUrl)
      await expect
        .poll(
          async () =>
            executeInBrowserGuest<string>(
              electronApp,
              orcaPage,
              `document.querySelector('main')?.textContent ?? ''`
            ),
          { timeout: 5_000 }
        )
        .toContain('Reached target')
    } finally {
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })

  test('remote pages are still blocked from navigating the embedded browser to local files', async ({
    electronApp,
    orcaPage
  }) => {
    const fixture = createLocalBrowserFixture()
    const remote = await createHttpFixturePage(fixture.targetUrl)
    try {
      const worktreeId = (await getActiveWorktreeId(orcaPage))!

      await createBrowserTab(orcaPage, worktreeId, remote.url)
      await expect.poll(async () => getActiveTabType(orcaPage), { timeout: 5_000 }).toBe('browser')
      await expect
        .poll(async () => getBrowserGuestUrl(electronApp, orcaPage), {
          timeout: 10_000,
          message: 'Browser guest did not load the remote fixture page'
        })
        .toBe(remote.url)

      await executeInBrowserGuest<void>(
        electronApp,
        orcaPage,
        `document.querySelector('#go')?.click()`
      )

      // Why: this is the original security purpose of the file-navigation
      // guard. A remote page may render a file:// link, but clicking it must
      // not move the guest into the user's local filesystem.
      await orcaPage.waitForTimeout(750)
      expect(await getBrowserGuestUrl(electronApp, orcaPage)).toBe(remote.url)
      expect(await executeInBrowserGuest<string>(electronApp, orcaPage, `document.title`)).toBe(
        'Remote Page'
      )
    } finally {
      await remote.close()
      rmSync(fixture.dir, { recursive: true, force: true })
    }
  })
})
