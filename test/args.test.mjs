import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { parseArgs, safeArgs } from '../settings.js'

// server.js 一加载就把日志目录定在 %APPDATA%\DSH，测试里 import 它要先把 APPDATA 挪开
process.env.APPDATA = mkdtempSync(join(tmpdir(), 'dsh-args-log-'))
const { bootArgs } = await import('../server.js')

const html = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8')

test('profile 走 --profile，不当位置参数（自建 profile 不是 dsh 的命令别名）', () => {
  assert.deepEqual(
    bootArgs('web-desktop', []),
    ['--profile', 'web-desktop', '--host', '127.0.0.1', '--port', '0', '--no-open'],
  )
  // 位置参数形式只对 web 这个别名有效，换成 safe / sdk-minimal 就会被 dsh 拒掉
  assert.deepEqual(bootArgs('safe', []).slice(0, 2), ['--profile', 'safe'], '名字必须跟在 --profile 后面')
})

test('额外参数仍然排在最后，用户可以覆盖端口', () => {
  assert.deepEqual(
    bootArgs('web', ['--port', '8080']).slice(-2),
    ['--port', '8080'],
    '用户参数原样追加在尾部',
  )
})

test('额外启动参数按空白分词', () => {
  assert.deepEqual(parseArgs('--log-level debug --no-open'), ['--log-level', 'debug', '--no-open'])
  assert.deepEqual(parseArgs('   --a\t1  \n --b 2 '), ['--a', '1', '--b', '2'])
})

test('引号里的空格原样保留', () => {
  assert.deepEqual(parseArgs('--msg "hello world" --x'), ['--msg', 'hello world', '--x'])
  assert.deepEqual(parseArgs("--msg 'a b c'"), ['--msg', 'a b c'])
  // 空字符串也是有意义的参数（比如 --flag ""）
  assert.deepEqual(parseArgs('--flag ""'), ['--flag', ''])
})

test('空输入和未闭合引号都不会炸', () => {
  assert.deepEqual(parseArgs(''), [])
  assert.deepEqual(parseArgs('   '), [])
  assert.deepEqual(parseArgs('--x "a b'), ['--x', 'a b'])
})

test('参数文本有长度上限', () => {
  assert.equal(safeArgs('  --a 1  '), '--a 1')
  assert.equal(safeArgs(undefined), '')
  assert.throws(() => safeArgs('x'.repeat(2001)), /太长/)
})

test('设置页有额外启动参数输入框，并会一起提交/回显', () => {
  // 标签上带着 data-i18n（静态文案走的是 t() 那条线），所以只认标签文字，不管属性
  assert.match(html, /<label class="field wide"><span[^>]*>额外启动参数<\/span><input id="args" type="text"/, '输入框在高级设置里且占一整行')
  assert.match(html, /args: argsEl\.value/, '保存时提交')
  assert.match(html, /if \('args' in data\) argsEl\.value = String\(data\.args \?\? ''\)/, '读设置时回填')
  assert.match(html, /空格分词，含空格的值用引号包起来/, '提示说明分词规则')
})
