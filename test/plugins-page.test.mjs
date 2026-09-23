import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const html = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8')

/** 页面上那份中英字典（`const EN = {` 到它自己的收尾大括号）。 */
function englishDictionary() {
  const match = /const EN = \{([\s\S]*?)\n    \}/.exec(html)
  assert.ok(match, '页面里应该找得到中英字典')
  return match[1]
}

test('插件行是容器：左边开关、右边卸载按钮，按钮不能嵌在 label 里', () => {
  // label 里的按钮会被当成"点标签=切开关"的一部分，卸载会顺手把开关拨了
  assert.match(html, /<div class="plugin-row\$\{plugin\.enabled \? '' : ' off'\}">/, '行本身是 div')
  assert.match(html, /<label class="toggle" title=/, '开关仍复用 .toggle 那套外观')
  assert.match(html, /<button class="ghost plugin-remove" type="button" data-remove=/, '卸载按钮在 label 外面')
  assert.match(html, /\.plugin-row \.toggle \{ flex: 1 1 auto; min-width: 0; margin: 0; \}/, '开关撑满剩余宽度、别带 .toggle 的外边距')
  assert.match(html, /\.plugin-remove \{ flex: 0 0 auto; \}/, '按钮不被压扁')
})

test('不可卸载的插件按钮置灰，原因写在 title 上', () => {
  assert.match(html, /\$\{plugin\.removable \? '' : 'disabled'\}/)
  assert.match(html, /title="\$\{escapeHtml\(t\(plugin\.removeReason \|\| '[^']*'\)\)\}"/, '原因走服务端给的 removeReason')
})

test('卸载前二次确认，成功后按有没有清停用行给不同回执', () => {
  assert.match(html, /async function removePlugin\(name\) \{/, '卸载和开关是两个动作')
  assert.match(html, /window\.confirm\(t\('要卸载 \{name\} 吗[\s\S]{0,80}整包删除/)
  assert.match(html, /post\('\/api\/plugins\/remove', \{ name \}\)/)
  assert.match(html, /renderPlugins\(data\)/)
  assert.match(html, /data\.prunedRows\?\.length/, '清掉停用行和不用的情况分开报')
  assert.match(html, /顺手清掉了它的停用行/)
})

test('卸载相关的中文文案都配了英文（切到 en 不能露出中文）', () => {
  const dictionary = englishDictionary()
  const keys = [
    '卸载这个插件（整包删掉，不只是停用）',
    '要卸载 {name} 吗？这是整包删除，不是停用；装回来要去插件市场重新安装。',
    '正在卸载 {name}…',
    '{name} 已卸载，顺手清掉了它的停用行。',
    '{name} 已卸载。',
    '官方组件不提供卸载',
    '客户端插件由插件市场管理，请到市场里卸载',
    '加载行全部由插件市场自管，在这里卸载会留下孤儿行，请到市场里卸载',
  ]
  for (const key of keys) {
    assert.ok(dictionary.includes(`"${key}": `), `缺英文词条：${key}`)
    assert.notEqual(dictionary.split(`"${key}": "`)[1]?.split('"')[0], key, '英文条目不该照抄中文')
  }
})

test('迁移相关的中文文案也配了英文', () => {
  const dictionary = englishDictionary()
  for (const key of [
    '把旧目录里已装的版本一起搬过去',
    '旧目录里有 {count} 个已装版本（每个几百 MB）。搬过去后旧目录就空了；只改目录的话得自己复制。',
    '已保存。版本目录已改为 {dir}，{count} 个已装版本一起搬过去了。',
    '已保存。版本目录已改为 {dir}（旧目录里没有已装版本，没什么可搬）。',
    '已保存。版本目录已改为 {dir}；旧目录里的版本没有搬，需要就手动复制过去。',
  ]) {
    assert.ok(dictionary.includes(`"${key}": `), `缺英文词条：${key}`)
  }
  // 旧文案（"不会自动迁移"）不该还留在字典里当僵尸
  assert.ok(!dictionary.includes('已安装的版本不会自动迁移'), '旧措辞要清掉')
})

test('插件页脚本仍能解析', () => {
  new vm.Script(/<script>([\s\S]*?)<\/script>/.exec(html)[1])
})
