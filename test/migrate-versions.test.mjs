import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { planVersionMigration } from '../settings.js'
import { migrateVersions, moveEntry } from '../server.js'

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
