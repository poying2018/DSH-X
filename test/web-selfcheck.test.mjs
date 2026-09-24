import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// server.js 一被 import 就把日志目录定在 %APPDATA%\DSH，先挪开再动态拿
process.env.APPDATA = mkdtempSync(join(tmpdir(), 'dsh-selfcheck-log-'))
const { checkWebPage, webHealthLines } = await import('../server.js')

/**
 * 假 dsh 页面：/ 返回给定 HTML；/plugins/** 按 routes（{ 模块id: 状态码 }）回应，缺省 200。
 * 合并 URL 形如 plugins/??<id>/client.js&rev=…，路径里没有可区分的段，所以按整条 url 找 id。
 */
function serve(html, routes = {}) {
  const server = createServer((req, res) => {
    if (req.url === '/' || req.url.startsWith('/?token=')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'set-cookie': 'dsh=probe; Path=/' })
      res.end(html)
      return
    }
    const id = Object.keys(routes).find((name) => req.url.includes(name))
    const status = id ? routes[id] : 200
    res.writeHead(status, { 'content-type': 'application/javascript' })
    res.end(status === 200 ? 'window.__ModuleLoader__.load({})' : 'not found')
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        origin: `http://127.0.0.1:${server.address().port}`,
        close: () => new Promise((done) => server.close(done)),
      })
    })
  })
}

const boot = (entries) => `<script>window.__DSH_BOOT__ = ${JSON.stringify({ rev: 'graph1', entries, batches: [] })}</script>`
// rc.1 真页面里就是这个形状：相对路径 + ?? 合并，整段 HTML 找不到一个 "/plugins/"
const entry = (id) => ({ id, url: `plugins/??${id}/client.js&rev=r1`, rev: 'r1', inject: [] })

test('rc.1 的合并 URL：客户端包按 __DSH_BOOT__ 清单数，失败要点名是谁', async () => {
  const page = `<html><head>
    <script src="plugins/??@deepseek-ai/dsh-client-modules/client.js&amp;rev=311aaa"></script>
    <script src="./assets/index-3dwByubT.js"></script>
    ${boot([entry('dshmarket'), entry('@kenz1117/dsh-ui-usage-billing'), entry('broken-plugin')])}
  </head><body></body></html>`
  const { origin, close } = await serve(page, { 'broken-plugin': 404 })
  try {
    const result = await checkWebPage(origin, 'tok')
    assert.equal(result.total, 3, '三个客户端模块都要被查到')
    assert.equal(result.ok, 2)
    assert.equal(result.failed.length, 1)
    assert.equal(result.failed[0].id, 'broken-plugin', '失败要带模块 id，不然日志里没法定位')
    assert.equal(result.failed[0].status, 404)
    assert.equal(result.source, 'boot')
  } finally {
    await close()
  }
})

test('老内核页面没有 __DSH_BOOT__ 时，仍按 /plugins/ 引用抓', async () => {
  const page = '<html><head><script src="/plugins/dshmarket/client.js"></script><script src="/plugins/dsh-tui/client.js"></script></head></html>'
  const { origin, close } = await serve(page)
  try {
    const result = await checkWebPage(origin, 'tok')
    assert.equal(result.total, 2)
    assert.equal(result.ok, 2)
    assert.deepEqual(result.failed, [])
    assert.equal(result.source, 'html')
  } finally {
    await close()
  }
})

test('两种来源都没有时报告"没清单"，不能算成"0 个全部正常"', async () => {
  const { origin, close } = await serve('<html><head><script src="./assets/index.js"></script></head></html>')
  try {
    const result = await checkWebPage(origin, 'tok')
    assert.equal(result.total, 0)
    assert.equal(result.source, 'none', '调用处要靠这个区分"没东西可查"和"全都正常"')
  } finally {
    await close()
  }
})

test('自检日志：没清单就说没清单', () => {
  const lines = webHealthLines({ total: 0, ok: 0, source: 'none', failed: [] })
  assert.equal(lines.length, 1)
  assert.match(lines[0], /没找到客户端插件清单/)
  assert.ok(!/全部正常/.test(lines[0]), '不能写成"0 个全部正常"糊过去')
})

test('自检日志：失败要点名模块 id，成功要报数', () => {
  const bad = webHealthLines({
    total: 3,
    ok: 2,
    source: 'boot',
    failed: [{ id: 'broken-plugin', url: 'plugins/??broken-plugin/client.js&rev=r1', status: 404 }],
  })
  assert.match(bad[0], /2\/3 个客户端插件包正常，1 个失败/)
  assert.match(bad[1], /broken-plugin/, '第二行要说清是哪个模块')
  assert.match(bad[1], /HTTP 404/)

  const good = webHealthLines({ total: 64, ok: 64, source: 'boot', failed: [] })
  assert.deepEqual(good, ['页面自检：64 个客户端插件包全部正常'])
})
