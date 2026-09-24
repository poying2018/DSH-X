import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const server = read('../server.js')
const html = read('../public/index.html')

test('更新提示认的是自己那份 release，不再指上游', () => {
  assert.match(server, /^const APP_REPO = 'poying2018\/DSH-X'$/m, '仓库地址改到 fork')
  assert.equal(
    (server.match(/https:\/\/github\.com\/\$\{APP_REPO\}/g) || []).length,
    3,
    '下载直链、releases 页、更新日志 atom 三处都从常量拼，不许多出字面量',
  )
})

test('/api/self 把仓库地址带出去，页面不再自己抄一份', () => {
  assert.equal((server.match(/url, repo: APP_REPO/g) || []).length, 2, '命中和兜底两条返回都要带 repo')
  assert.match(html, /https:\/\/github\.com\/\$\{data\.repo\}\/releases\/latest\/download\/DSH-Setup\.exe/)
  assert.doesNotMatch(html, /github\.com\/yyh-001\/DSH-X\/releases/, '页面里不该再有上游的更新链接（Star 按钮那条不算）')
  assert.match(html, /href="https:\/\/github\.com\/yyh-001\/DSH-X"/, 'Star 仍然指原项目，那是署名不是更新源')
})
