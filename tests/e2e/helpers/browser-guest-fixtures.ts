import { expect, type ElectronApplication, type Page } from '@stablyai/playwright-test'
import { mkdirSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

async function getActiveBrowserGuestWebContentsId(page: Page): Promise<number> {
  await expect
    .poll(
      async () =>
        page.evaluate(() => {
          const webview = document.querySelector('webview') as
            | (Element & { getWebContentsId?: () => number })
            | null
          return webview?.getWebContentsId?.() ?? null
        }),
      { timeout: 10_000, message: 'Browser webview did not register a guest WebContents id' }
    )
    .not.toBeNull()

  const id = await page.evaluate(() => {
    const webview = document.querySelector('webview') as
      | (Element & { getWebContentsId?: () => number })
      | null
    return webview?.getWebContentsId?.() ?? null
  })
  if (id === null) {
    throw new Error('Browser webview did not expose a guest WebContents id')
  }
  return id
}

export async function executeInBrowserGuest<T>(
  app: ElectronApplication,
  page: Page,
  expression: string
): Promise<T> {
  const webContentsId = await getActiveBrowserGuestWebContentsId(page)
  return app.evaluate(
    async ({ webContents }, args) => {
      const guest = webContents.fromId(args.webContentsId)
      if (!guest || guest.isDestroyed()) {
        throw new Error(`Browser guest ${args.webContentsId} is not available`)
      }
      return guest.executeJavaScript(args.expression, true)
    },
    { webContentsId, expression }
  ) as Promise<T>
}

export async function getBrowserGuestUrl(app: ElectronApplication, page: Page): Promise<string> {
  const webContentsId = await getActiveBrowserGuestWebContentsId(page)
  return app.evaluate(({ webContents }, id) => {
    const guest = webContents.fromId(id)
    if (!guest || guest.isDestroyed()) {
      throw new Error(`Browser guest ${id} is not available`)
    }
    return guest.getURL()
  }, webContentsId)
}

export function createLocalBrowserFixture(): { dir: string; indexUrl: string; targetUrl: string } {
  const dir = path.join(
    tmpdir(),
    `orca-browser-file-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`
  )
  mkdirSync(dir, { recursive: true })
  const indexPath = path.join(dir, 'index.html')
  const targetPath = path.join(dir, 'target.html')
  writeFileSync(
    indexPath,
    '<!doctype html><title>Local Index</title><a id="go" href="./target.html">Open target</a>'
  )
  writeFileSync(targetPath, '<!doctype html><title>Local Target</title><main>Reached target</main>')
  return {
    dir,
    indexUrl: pathToFileURL(indexPath).toString(),
    targetUrl: pathToFileURL(targetPath).toString()
  }
}

export async function createHttpFixturePage(linkTargetUrl: string): Promise<{
  url: string
  close: () => Promise<void>
}> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      `<!doctype html><title>Remote Page</title><a id="go" href="${linkTargetUrl}">Open local file</a>`
    )
  })

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('HTTP fixture server did not bind to a TCP port')
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}
