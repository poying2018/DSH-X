import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// 同 migrate-versions.test.mjs：先把 APPDATA 挪开再动态 import，否则测试会往真用户的
// %APPDATA%\DSH 里写日志、还会读到真设置里的目录。
process.env.APPDATA = mkdtempSync(join(tmpdir(), 'dsh-settings-api-log-'))
process.env.PORT = '4111'
const ROOT = mkdtempSync(join(tmpdir(), 'dsh-settings-api-'))
process.env.DSH_VERSIONS_DATA = join(ROOT, 'versions')
process.env.DSH_HOME_DIR = join(ROOT, 'home')
const { startServer, stopAll } = await import('../server.js')

const BASE = 'http://127.0.0.1:4111'

async function save(body) {
  const res = await fetch(`${BASE}/api/settings`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  return { status: res.status, data: await res.json() }
}

test('换目录的回执要能区分"搬了/没让搬/其实没换"三种情况', async () => {
  await startServer()
  try {
    // 旧家目录里放两项东西，模拟"有已装插件"
    mkdirSync(join(ROOT, 'home', 'stuff'), { recursive: true })
    writeFileSync(join(ROOT, 'home', 'stuff', 'a.txt'), 'a')
    const target = join(ROOT, 'home_moved')

    const first = await save({ dshHome: target, migrateDshHome: true })
    assert.equal(first.status, 200)
    assert.equal(first.data.dshHomeChanged, true, '这次是真的换了目录')
    assert.deepEqual(first.data.migratedHome.sort(), ['profiles', 'stuff'])

    // 再提交一次同样的目录：服务端已经在目标目录上，什么都没做
    const again = await save({ dshHome: target, migrateDshHome: true })
    assert.equal(again.data.dshHomeChanged, false, '目录其实没变')
    assert.equal('migratedHome' in again.data, false, '没跑迁移就不该报搬了什么')

    // 明确不搬：换了目录但 migratedHome 缺席，页面据此说"没搬"
    const third = join(ROOT, 'home_pointer_only')
    const noMove = await save({ dshHome: third, migrateDshHome: false })
    assert.equal(noMove.data.dshHomeChanged, true)
    assert.equal('migratedHome' in noMove.data, false)
    assert.deepEqual(readdirSync(target).sort(), ['profiles', 'stuff'], '不搬的话东西得还留在原地')

    // 版本目录那一侧走的是同一套回执
    const versions = join(ROOT, 'versions_moved')
    const movedDir = await save({ dataDir: versions, migrateVersions: true })
    assert.equal(movedDir.data.dataDirChanged, true)
    assert.deepEqual(movedDir.data.migrated, [], '这个环境里没装版本，搬了个空数组也要照实回')
    const sameDir = await save({ dataDir: versions, migrateVersions: true })
    assert.equal(sameDir.data.dataDirChanged, false, '同一个目录再提交一次：什么都没做')
    assert.equal('migrated' in sameDir.data, false)
  } finally {
    await stopAll()
  }
})
