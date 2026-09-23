import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { planMove, planVersionMigration, resolveDshHome, safeDshHome } from '../settings.js'

// server.js 一被 import 就把日志目录定在 %APPDATA%\DSH，而迁移过程是要 pushLog 的——
// 不先把 APPDATA 指到临时目录，跑一次测试就往真用户的 manager.log 里写一堆假失败。
process.env.APPDATA = mkdtempSync(join(tmpdir(), 'dsh-migrate-log-'))
const { migrateVersions, migrateHome, moveEntry } = await import('../server.js')

/** 造一个版本目录：DATA/versions/<ver>/node_modules/… + DATA/config.json */
function makeData(versions) {
  const base = mkdtempSync(join(tmpdir(), 'dsh-migrate-'))
  for (const version of versions) {
    const dir = join(base, 'versions', version, 'node_modules')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'marker.txt'), version)
  }
  writeFileSync(join(base, 'config.json'), JSON.stringify({ versions }, null, 2))
  return base
}

test('计划只搬目标目录里没有的版本', () => {
  assert.deepEqual(planVersionMigration(['1.0.0', '2.0.0'], ['1.0.0']), {
    movable: ['2.0.0'],
    blocked: ['1.0.0'],
  })
})

test('同盘：版本目录和 config.json 一起搬过去，源目录清空', async () => {
  const from = makeData(['1.0.0', '2.0.0'])
  const to = mkdtempSync(join(tmpdir(), 'dsh-migrate-to-'))
  const moved = await migrateVersions(from, to)
  assert.deepEqual(moved.sort(), ['1.0.0', '2.0.0'])
  assert.equal(readFileSync(join(to, 'versions', '1.0.0', 'node_modules', 'marker.txt'), 'utf8'), '1.0.0')
  assert.deepEqual(JSON.parse(readFileSync(join(to, 'config.json'), 'utf8')).versions, ['1.0.0', '2.0.0'])
  assert.deepEqual(readdirSync(join(from, 'versions')), [], '源目录该空了')
})

test('目标目录已有 config.json 时不覆盖它', async () => {
  const from = makeData(['1.0.0'])
  const to = mkdtempSync(join(tmpdir(), 'dsh-migrate-to-'))
  writeFileSync(join(to, 'config.json'), '{"versions":["9.9.9"]}')
  await migrateVersions(from, to)
  assert.deepEqual(JSON.parse(readFileSync(join(to, 'config.json'), 'utf8')).versions, ['9.9.9'])
})

test('目标目录里有同名版本就直接拒绝，源目录一个都不动', async () => {
  const from = makeData(['1.0.0', '2.0.0'])
  const to = makeData(['2.0.0'])
  await assert.rejects(() => migrateVersions(from, to), (error) => {
    assert.match(error.message, /2\.0\.0/, '要点名是哪个版本撞了')
    assert.match(error.message, /已存在|先清/, '要说清怎么处理')
    return true
  })
  assert.deepEqual(readdirSync(join(from, 'versions')).sort(), ['1.0.0', '2.0.0'], '拒绝时不能已经搬走一半')
})

test('搬到一半失败要把已搬的放回源目录', async () => {
  const from = makeData(['1.0.0', '2.0.0'])
  const to = mkdtempSync(join(tmpdir(), 'dsh-migrate-to-'))
  // 可控失败：1.0.0 真搬走，搬 2.0.0 时假装盘掉了（走 move 这条测试缝）
  const boom = new Error('模拟：磁盘掉线')
  const moves = []
  await assert.rejects(
    () =>
      migrateVersions(from, to, {
        move: (source, target) => {
          moves.push([source, target])
          if (target.includes('2.0.0')) return Promise.reject(boom)
          return moveEntry(source, target)
        },
      }),
    /放回原目录/,
  )
  assert.ok(existsSync(join(from, 'versions', '1.0.0', 'node_modules', 'marker.txt')), '1.0.0 要回到源目录')
  assert.ok(existsSync(join(from, 'versions', '2.0.0', 'node_modules', 'marker.txt')), '2.0.0 本来就没动')
  assert.equal(existsSync(join(to, 'versions', '1.0.0')), false, '目标目录不该留下半个版本')
  assert.equal(readFileSync(join(from, 'config.json'), 'utf8').includes('1.0.0'), true, 'config.json 也得留在源目录')
  assert.equal(moves.filter(([source]) => source === join(from, 'config.json')).length, 0, 'config.json 失败前不该被搬')
})

test('源目录没有 versions 时等于空迁移，不报错', async () => {
  const from = mkdtempSync(join(tmpdir(), 'dsh-migrate-empty-'))
  const to = mkdtempSync(join(tmpdir(), 'dsh-migrate-to-'))
  assert.deepEqual(await migrateVersions(from, to), [])
})

test('planMove 就是"目标已有的算冲突"', () => {
  assert.deepEqual(planMove(['b', 'a'], ['a']), { movable: ['b'], blocked: ['a'] })
})

test('插件家目录：顶层条目整个搬走，文件和目录一样对待', async () => {
  const from = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const to = mkdtempSync(join(tmpdir(), 'dsh-home-to-'))
  mkdirSync(join(from, 'profiles', 'web'), { recursive: true })
  writeFileSync(join(from, 'profiles', 'web', 'cordis.patch.yml'), '[]\n')
  writeFileSync(join(from, '.credentials.yaml'), 'token: x\n')
  const moved = await migrateHome(from, to)
  assert.deepEqual(moved.sort(), ['.credentials.yaml', 'profiles'])
  assert.equal(readFileSync(join(to, 'profiles', 'web', 'cordis.patch.yml'), 'utf8'), '[]\n')
  assert.equal(existsSync(join(from, 'profiles')), false, '源目录要空出来')
})

test('插件家目录：目标已有同名条目时拒绝，源目录不动', async () => {
  const from = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const to = mkdtempSync(join(tmpdir(), 'dsh-home-to-'))
  mkdirSync(join(from, 'profiles', 'web'), { recursive: true })
  mkdirSync(join(to, 'profiles'), { recursive: true })
  await assert.rejects(() => migrateHome(from, to), (error) => {
    assert.match(error.message, /profiles/, '要点名撞的是哪个')
    assert.match(error.message, /已存在|先清/)
    return true
  })
  assert.ok(existsSync(join(from, 'profiles', 'web')), '拒绝时不能已经搬走')
})

test('插件家目录：搬到一半失败要回滚', async () => {
  const from = mkdtempSync(join(tmpdir(), 'dsh-home-'))
  const to = mkdtempSync(join(tmpdir(), 'dsh-home-to-'))
  mkdirSync(join(from, 'cache'), { recursive: true })
  writeFileSync(join(from, 'credentials.yaml'), 'x')
  await assert.rejects(
    () =>
      migrateHome(from, to, {
        move: (source, target) => (target.includes('credentials') ? Promise.reject(new Error('模拟：被占用')) : moveEntry(source, target)),
      }),
    /放回原目录/,
  )
  assert.ok(existsSync(join(from, 'cache')), '先搬走的 cache 要放回源目录')
  assert.ok(existsSync(join(from, 'credentials.yaml')))
  assert.equal(existsSync(join(to, 'cache')), false, '目标目录不该留半个')
})

test('插件目录只认绝对路径', () => {
  assert.throws(() => safeDshHome(''), /插件目录不能为空/)
  assert.throws(() => safeDshHome('dsh-plugins'), /请使用绝对路径/)
  assert.equal(safeDshHome('D:\\dsh-plugins'), resolve('D:\\dsh-plugins'))
})

test('插件目录：环境变量优先，脏值回默认而不是一把抛死', () => {
  const base = mkdtempSync(join(tmpdir(), 'dsh-home-env-'))
  process.env.DSH_HOME_DIR = base
  assert.equal(resolveDshHome(), base)
  process.env.DSH_HOME_DIR = 'relative-nope'
  assert.equal(resolveDshHome(), join(homedir(), '.dsh'), '环境变量不合法就用默认，别让启动器起不来')
  delete process.env.DSH_HOME_DIR
})
