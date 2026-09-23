import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { applyPickerMode, setDirectoryPickerMode, readPatchState } from '../plugins.js'

const AUTO_ROW = '- id: directory-picker\n  disabled: true\n'
const INSERT_BLOCK = `- insert:\n    - id: directory-picker-host\n      name: '@deepseek-ai/dsh-host-directory-picker-browse'\n    - id: directory-picker-ui\n      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse'\n`

test('切到 browse：停掉 auto 那行并插入 host + client 两条', () => {
  const next = applyPickerMode('[]\n', 'browse')
  assert.ok(next.includes(AUTO_ROW), '要停掉 directory-picker')
  assert.ok(next.includes(INSERT_BLOCK), '要插入 browse 的一对条目')
  assert.ok(!next.includes('[]'), '有内容了就不该留 [] 占位')
})

test('重复切是幂等的，不会把行叠一遍', () => {
  const once = applyPickerMode('[]\n', 'browse')
  assert.equal(applyPickerMode(once, 'browse'), once)
  assert.equal(applyPickerMode(applyPickerMode(once, 'browse'), 'browse'), once)
})

test('切回 auto 只删我们写过的那几行，别人的停用行不动', () => {
  const base = '- id: import-claude\n  disabled: true\n'
  const withBrowse = applyPickerMode(base, 'browse')
  assert.equal(applyPickerMode(withBrowse, 'auto'), base)
})

test('切回 auto 后补丁层空了就恢复 [] 占位，否则 dsh 起不来', () => {
  assert.equal(applyPickerMode(applyPickerMode('[]\n', 'browse'), 'auto').trim(), '[]')
})

test('insert 块里别人的行要留着', () => {
  const foreign = "- insert:\n    - id: someone-else\n      name: 'other-pkg'\n"
  const next = applyPickerMode(`${foreign}[]\n`, 'auto')
  assert.ok(next.includes('someone-else'), '不该顺手删掉别人的插入行')
  assert.ok(!next.includes('directory-picker-host'), '我们那两条要清干净')
})

test('写盘版：真的改文件并留 .bak，第二次调用不再动', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-picker-'))
  mkdirSync(join(dir, 'profiles', 'web'), { recursive: true })
  const profile = join(dir, 'profiles', 'web')
  writeFileSync(join(profile, 'cordis.patch.yml'), '[]\n')
  assert.equal(setDirectoryPickerMode(profile, 'browse').changed, true)
  const text = readFileSync(join(profile, 'cordis.patch.yml'), 'utf8')
  assert.ok(text.includes(AUTO_ROW) && text.includes(INSERT_BLOCK))
  assert.equal(readFileSync(join(profile, 'cordis.patch.yml.bak'), 'utf8').trim(), '[]')
  assert.equal(setDirectoryPickerMode(profile, 'browse').changed, false)
  assert.deepEqual(readPatchState(join(profile, 'cordis.patch.yml')).disables, ['directory-picker'])
})
