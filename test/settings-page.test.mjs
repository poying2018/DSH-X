import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const html = readFileSync(fileURLToPath(new URL('../public/index.html', import.meta.url)), 'utf8')

/** 页面里那段没有打包器的内联脚本（改设置页时最容易碰坏它）。 */
const inlineScripts = () => {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  assert.ok(scripts.length, '页面里应该有内联脚本')
  return scripts.map((match) => match[1])
}

test('设置页有版本目录入口，用整行的设置项样式，旁边是目录选择按钮', () => {
  // 版本目录是长路径，用 .set-row.stacked 占一整行，输入框铺满并带「浏览…」按钮；profile / 端口仍是窄行
  // 标签上带着 data-i18n（静态文案走的是 t() 那条线），所以只认标签文字，不管属性
  assert.match(
    html,
    /<div class="set-row stacked">[\s\S]{0,600}?<input id="dataDir" type="text" \/>[\s\S]{0,200}?<button class="ghost" id="pickDir"/,
    '版本目录单独占一行（.set-row.stacked），旁边有目录选择按钮',
  )
  assert.match(html, /post\('\/api\/pick-dir'/, '浏览按钮走 /api/pick-dir')
  assert.match(html, /\.set-row\.stacked \{ display: block; \}/, '整行样式存在')
  assert.match(html, /<div class="set-control"><select id="profile"><\/select><\/div>/, 'profile 仍是窄行下拉')
  assert.match(html, /<p class="hint" id="dataDirHint"><\/p>/, '提示行复用 .hint（空内容自动隐藏）')
  // 文本输入框本来就在样式表里，新控件不需要额外 CSS
  assert.match(html, /input\[type=text\], input\[type=number\], select \{/)
})

test('顶栏四个 tab 已取消，设置分类在左侧导航，主页右上角是齿轮入口', () => {
  assert.ok(!/<nav>/.test(html), '顶栏那排 tab 应该去掉')
  assert.ok(!/data-tab=/.test(html), '不该再用 data-tab 切页面')
  assert.match(html, /<button type="button" class="gear-btn" id="settingsEntry"/, '右上角是设置入口')
  // 控制仍是主界面：落地就是它，回到控制时把左侧导航收起来，主页还是那张控制卡片
  assert.match(html, /<main class="home">/, '落地时是控制面板')
  assert.match(html, /main\.home \.settings-nav \{ display: none; \}/, '主界面不显示左侧导航')
  for (const [pane, label] of [['control', '控制'], ['plugins', '插件'], ['log', '日志'], ['settings', '设置']]) {
    assert.match(html, new RegExp(`class="nav-item[^"]*" data-pane="${pane}"`), `${label} 要在左侧导航里`)
    assert.match(html, new RegExp(`<section class="pane[^"]*" id="pane-${pane}">`), `${label} 的面板要在设置页里`)
  }
  for (const category of ['general', 'appearance', 'advanced']) {
    assert.match(html, new RegExp(`data-pane="settings" data-category="${category}"`), `${category} 有独立的导航入口`)
    assert.match(html, new RegExp(`class="set-section" data-category="${category}"`), `${category} 有独立的设置内容`)
  }
  // dsh 不再单开一类：入口没了，那组设置项并进了常规（给个 set-caption 小标题）
  assert.doesNotMatch(html, /data-category="dsh"/, 'dsh 分类已经并进常规')
  assert.match(
    html,
    /<section class="set-section" data-category="general"[\s\S]{0,3000}?<div class="set-caption"[^>]*>dsh<\/div>[\s\S]{0,3000}?id="seedMarket"[\s\S]{0,2000}?id="profile"/,
    '插件市场 / 启动 profile 现在挂在常规里',
  )
  assert.match(html, /section\.hidden = section\.dataset\.category !== nextCategory/, '切换分类只显示对应设置')
  assert.match(html, /gearEl\.onclick = \(\) => showPane\(currentPane === 'settings' \? 'control' : 'settings', currentSettingsCategory\)/, '齿轮在设置与主界面间切换')
  assert.match(html, /const paneLoaders = \{ plugins: loadPlugins, settings: loadSettings \}/, '进面板时才按需加载')
})

test('设置改变后自动提交，目录留空时拒绝提交', () => {
  assert.doesNotMatch(html, /id="saveSettings"/, '不再显示保存按钮')
  assert.match(html, /autoStartEl\.onchange = \(\) => queueSetting\('autoStart', autoStartEl\.checked\)/)
  assert.match(html, /uiLangEl\.onchange = \(\) => queueSetting\('lang', uiLangEl\.value\)/)
  assert.match(html, /dataDirEl\.onchange = \(\) => moveFields\[0\]\.commit\(\)/)
  assert.match(html, /dshHomeEl\.onchange = \(\) => moveFields\[1\]\.commit\(\)/)
  assert.match(html, /commit: \(\) => \{[\s\S]{0,160}?if \(dir\) queueSetting\('dataDir', dir\)/, '提交走 moveFields 里的 commit')
  assert.match(html, /queueSetting\('dshHome', dir\)/)
  assert.match(html, /const data = await post\('\/api\/settings', patch\)/)
})

test('版本目录和插件目录各一行，说明文字不再互相指错地方', () => {
  assert.match(html, /if \('dataDir' in data\) \{[\s\S]*?dataDirEl\.value = String\(data\.dataDir \?\? ''\)/)
  assert.match(html, /if \('dshHome' in data\) \{[\s\S]*?dshHomeEl\.value = String\(data\.dshHome \?\? ''\)/)
  // 插件现在有自己的目录字段了，版本目录那句不该再提"插件仍在别处"
  assert.match(html, /dataDirHint\.textContent = t\('dsh 各版本装在这里（几百 MB 一个）。'\)/)
  assert.ok(!html.includes('插件和 profile 仍在'), '旧措辞要清掉')
  // 插件目录那句要给出默认位置和"改了要重启 dsh"，家目录用 {home} 占位
  assert.match(html, /dshHomeHint\.textContent = t\('插件、profile 和 dsh 的数据都在这里[\s\S]{0,60}?\{home\}[\s\S]{0,60}?home: data\.dshHomeDefault/)
})

test('改过目录且旧目录有东西时，问一句要不要一起搬（两个目录各一行）', () => {
  // 只有"目录改了" + "旧目录里确实有东西"两个条件都成立才出现这一行，否则是白噪音
  assert.match(html, /<label class="toggle set-row" id="migrateRow" hidden>/, '默认隐藏')
  // .set-row 自带 display:flex，会盖掉 [hidden] 的默认 none —— 少了这条规则，"默认隐藏"是假的
  assert.match(html, /\.set-row\[hidden\] \{ display: none; \}/, 'hidden 要有对应的显示规则兜住')
  assert.match(html, /<input id="migrateVersions" type="checkbox" checked/, '默认搬过去')
  assert.match(html, /<label class="toggle set-row" id="homeMigrateRow" hidden>/, '插件目录那行同样默认隐藏')
  assert.match(html, /<input id="migrateDshHome" type="checkbox" checked/)
  // 两个字段共用一套：版本数取自动态 /api/state，家目录条目数由服务端跟着设置一起回传
  assert.match(html, /const moveFields = \[/)
  assert.match(html, /count: async \(\) => \(\(await getJson\('\/api\/state'\)\)\.versions \|\| \[\]\)\.length/)
  assert.match(html, /count: async \(\) => liveHomeEntries/)
  assert.match(html, /liveHomeEntries = Number\(data\.dshHomeEntries\) \|\| 0/)
  assert.match(html, /const show = edited && count > 0/)
  assert.match(html, /field\.row\.hidden = !show/)
  assert.match(html, /field\.input\.oninput = refreshMigrateRow/, '手打路径也要立刻出提示')
  // 装完/卸完版本后数字得跟着变
  assert.match(html, /maybeLaunch\(\)\s*\n\s*\/\/[^\n]*\n\s*refreshMigrateRow\(\)/, 'applyState 里刷新一次')
})

test('保存时把两个目录和各自的迁移意愿一起提交，并回显搬了几个', () => {
  // 只在目录真的改了时带迁移标志：同目录提交不该被当成"不迁移"
  assert.match(html, /const dirChanged = 'dataDir' in patch && normDir\(patch\.dataDir\) !== normDir\(liveDataDir\)/)
  assert.match(html, /const homeChanged = 'dshHome' in patch && normDir\(patch\.dshHome\) !== normDir\(liveDshHome\)/)
  assert.match(html, /if \(dirChanged\) patch\.migrateVersions = migrateEl\.checked/)
  assert.match(html, /if \(homeChanged\) patch\.migrateDshHome = homeMigrateEl\.checked/)
  assert.match(html, /Array\.isArray\(data\.migrated\) && data\.migrated\.length/, '搬成功：报数量')
  assert.match(html, /Array\.isArray\(data\.migratedHome\)/, '插件目录的回执看 migratedHome')
  assert.match(html, /个已装版本一起搬过去了/, '搬成功地点名"一起搬过去了"')
  assert.match(html, /（旧目录里没有已装版本，没什么可搬）/, '没东西可搬也要说清，别让人以为静默失败了')
  assert.match(html, /旧目录里的版本没有搬/, '只改目录：明说版本还在旧目录')
  assert.match(html, /项内容一起搬过去了/)
  // 末尾斜杠不该误判成"改过"：用户常带着 '\' 保存
  assert.match(html, /const normDir = \(value\) => String\(value \?\? ''\)\.trim\(\)\.replace\(\/\[\\\\\/\]\+\$\/, ''\)/)
  assert.match(html, /liveDataDir = String\(data\.dataDir \?\? liveDataDir\)/, '提交后要把服务端真在用的目录记下来')
  assert.match(html, /liveDshHome = String\(data\.dshHome \?\? liveDshHome\)/)
  // 文案分支看服务端回执，不看页面自己那份可能过期的 live 值
  assert.match(html, /if \('dshHome' in patch\) \{[\s\S]{0,80}?if \(data\.dshHomeChanged === false\)/, '"其实没换目录"要单独说一句')
  assert.match(html, /if \('dataDir' in patch\) \{[\s\S]{0,80}?if \(data\.dataDirChanged === false\)/)
  assert.match(html, /版本目录已经是 \{dir\} 了，没动东西。/)
  assert.match(html, /插件目录已经是 \{dir\} 了，没动东西。/)
  // 新目录名用 {dir} 占位传进去，别只断言写死了半句
  assert.match(html, /\{ dir: data\.dataDir, count: data\.migrated\.length \}/, '数量也是占位传进去的')
  assert.match(html, /\{ dir: data\.dshHome, count: data\.migratedHome\.length \}/)
})

test('「页面内选目录」开关接好线（默认开）', () => {
  assert.match(html, /<label class="toggle set-row">\s*<span class="set-text">\s*<span class="set-name" data-i18n="页面内选目录">[\s\S]{0,300}?<input id="inAppPicker" type="checkbox" \/>/, '开关在常规那组里')
  assert.match(html, /if \('inAppDirectoryPicker' in data\) inAppPickerEl\.checked = data\.inAppDirectoryPicker !== false/)
  assert.match(html, /inAppPickerEl\.onchange = \(\) => queueSetting\('inAppDirectoryPicker', inAppPickerEl\.checked\)/, '改动即提交')
  // 提示行要讲清为什么要换后端，别留个看不懂的开关
  assert.match(html, /data-i18n="选工作区时在页面里浏览目录[^"]*后台启动时弹的框选完回不来/)
  const dictionary = /const EN = \{([\s\S]*?)\n    \}/.exec(html)?.[1] ?? ''
  for (const key of ['页面内选目录', '选工作区时在页面里浏览目录，而不是让内核弹系统对话框（后台启动时弹的框选完回不来）。']) {
    assert.ok(dictionary.includes(`"${key}": `), `缺英文词条：${key}`)
  }
})

test('内联脚本仍能解析', () => {
  // 只编译不运行：语法坏了这里就炸，运行时的行为靠上面的结构断言看住
  for (const script of inlineScripts()) new vm.Script(script)
})
