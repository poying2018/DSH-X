import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { planPluginRemoval, prunePluginRows } from '../plugins.js'

/**
 * 造一个 profile：包清单 + node_modules 里的传统位置补丁（packageRowIds 认这个）。
 * rootPatch 是用户补丁层 cordis.patch.yml 的初始内容。
 */
function makeProfile(packages, rootPatch = '[]\n') {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-remove-'))
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ name: 'profile', dependencies: Object.fromEntries(packages.map((p) => [p.name, '1.0.0'])) }),
  )
  for (const pkg of packages) {
    const pkgDir = join(dir, 'node_modules', pkg.name)
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name: pkg.name, version: '1.0.0' }))
    if (pkg.rows.length) {
      writeFileSync(join(pkgDir, 'cordis.patch.yml'), pkg.rows.map((id) => `- insert:\n    - id: ${id}\n`).join(''))
    }
  }
  writeFileSync(join(dir, 'cordis.patch.yml'), rootPatch)
  return dir
}

const NORMAL = [{ name: 'graph-memory', rows: ['graph-memory'] }]

test('普通插件可以卸载，并带回应清理的加载行', () => {
  const profile = makeProfile(NORMAL)
  assert.deepEqual(planPluginRemoval(profile, 'graph-memory'), { removable: true, ids: ['graph-memory'] })
})

test('官方组件不提供卸载', () => {
  const profile = makeProfile([{ name: '@deepseek-ai/dsh-core', rows: ['core'] }])
  const plan = planPluginRemoval(profile, '@deepseek-ai/dsh-core')
  assert.equal(plan.removable, false)
  assert.match(plan.reason, /官方组件/)
})

test('客户端插件（没有可开关的加载行）交给市场，不在这里删', () => {
  const profile = makeProfile([{ name: 'schemastery', rows: [] }])
  const plan = planPluginRemoval(profile, 'schemastery')
  assert.equal(plan.removable, false)
  assert.match(plan.reason, /市场/)
})

test('全是市场自管行的插件删了会留孤儿行，拒绝', () => {
  const profile = makeProfile([{ name: 'dsh-market', rows: ['mkt-runtime', 'client-boot'] }])
  const plan = planPluginRemoval(profile, 'dsh-market')
  assert.equal(plan.removable, false)
  assert.match(plan.reason, /孤儿行/)
})

test('市场自管行混着自有行时可以卸载，但只报自有行', () => {
  const profile = makeProfile([{ name: 'dsh-thing', rows: ['mkt-x', 'own-y'] }])
  assert.deepEqual(planPluginRemoval(profile, 'dsh-thing'), { removable: true, ids: ['own-y'] })
})

test('不在已装清单里的包名直接报错', () => {
  const profile = makeProfile(NORMAL)
  assert.throws(() => planPluginRemoval(profile, 'nope'), /不在当前 profile/)
})

test('卸载后清掉该包的停用行，别人的行原样留着', () => {
  const profile = makeProfile(NORMAL, '- id: graph-memory\n  disabled: true\n- id: other-row\n  disabled: true\n')
  const patchPath = join(profile, 'cordis.patch.yml')
  const result = prunePluginRows(patchPath, ['graph-memory'])
  assert.equal(result.changed, true)
  const text = readFileSync(patchPath, 'utf8')
  assert.ok(!text.includes('graph-memory'), '该包的停用行要没了')
  assert.ok(text.includes('other-row'), '其它插件的停用行不能跟着掉')
})

test('含其它覆盖键的行只删 disabled 键，不整行删', () => {
  const profile = makeProfile(NORMAL, '- id: graph-memory\n  name: 改名\n  disabled: true\n')
  prunePluginRows(join(profile, 'cordis.patch.yml'), ['graph-memory'])
  const text = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.ok(text.includes('name: 改名'))
  assert.ok(!/disabled/.test(text))
})

test('补丁层被清空时恢复 [] 占位，否则 dsh 起不来', () => {
  const profile = makeProfile(NORMAL, '- id: graph-memory\n  disabled: true\n')
  prunePluginRows(join(profile, 'cordis.patch.yml'), ['graph-memory'])
  assert.equal(readFileSync(join(profile, 'cordis.patch.yml'), 'utf8').trim(), '[]')
})

test('没有可清的行就不写文件、不建备份', () => {
  const profile = makeProfile(NORMAL, '[]\n')
  const patchPath = join(profile, 'cordis.patch.yml')
  const before = readFileSync(patchPath, 'utf8')
  assert.equal(prunePluginRows(patchPath, ['graph-memory']).changed, false)
  assert.equal(readFileSync(patchPath, 'utf8'), before)
  assert.ok(!existsSync(`${patchPath}.bak`), '没改动就不该留备份')
})

test('改动前留一份 .bak', () => {
  const profile = makeProfile(NORMAL, '- id: graph-memory\n  disabled: true\n')
  const patchPath = join(profile, 'cordis.patch.yml')
  prunePluginRows(patchPath, ['graph-memory'])
  assert.equal(readFileSync(`${patchPath}.bak`, 'utf8').includes('graph-memory'), true)
})
