/**
 * 「消息快捷操作」的网页应用页面（单文件，无构建步骤）。
 * 流程：JSSDK 鉴权 → requestAccess 登录 → 读取被选中的消息 → 渲染创建 Issue 表单 → 提交。
 */
export function renderMessageActionPage(appId: string): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
<title>转为 Linear Issue</title>
<style>
  :root { color-scheme: light dark; --b:#d0d5dd; --p:#3370ff; }
  * { box-sizing: border-box; }
  body { margin:0; padding:16px; font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif; }
  h1 { font-size:16px; margin:0 0 12px; }
  label { display:block; margin:12px 0 4px; font-weight:600; }
  input[type=text], textarea, select { width:100%; padding:8px; border:1px solid var(--b); border-radius:6px; font:inherit; background:transparent; color:inherit; }
  textarea { min-height:120px; resize:vertical; }
  .row { display:flex; gap:12px; } .row > div { flex:1; }
  .chips { display:flex; flex-wrap:wrap; gap:6px; }
  .chip { border:1px solid var(--b); border-radius:14px; padding:2px 10px; cursor:pointer; user-select:none; }
  .chip.on { background:var(--p); border-color:var(--p); color:#fff; }
  button { margin-top:16px; padding:10px 16px; border:0; border-radius:6px; background:var(--p); color:#fff; font:inherit; font-weight:600; width:100%; }
  button[disabled] { opacity:.5; }
  .sec { background:transparent; color:var(--p); border:1px solid var(--p); margin-top:8px; }
  .msg { padding:10px; border-radius:6px; margin:8px 0; background:rgba(51,112,255,.08); }
  .err { background:rgba(240,68,56,.1); color:#d92d20; }
  .hint { color:#667085; font-size:12px; }
  .quote { border-left:3px solid var(--b); padding:4px 10px; margin:8px 0; color:#667085; max-height:90px; overflow:auto; white-space:pre-wrap; }
</style>
<script src="https://lf-scm-cn.feishucdn.com/lark/op/h5-js-sdk-1.5.48.js"></script>
</head>
<body>
<h1>转为 Linear Issue</h1>
<div id="app"><div class="msg">正在连接飞书…</div></div>
<script>
(function () {
  var APP_ID = ${JSON.stringify(appId)};
  var app = document.getElementById('app');
  var token = '', ctx = null;

  function show(html, cls) { app.innerHTML = '<div class="msg ' + (cls || '') + '">' + html + '</div>'; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'})[c]; }); }
  function api(path, body, method) {
    return fetch(path, {
      method: method || (body ? 'POST' : 'GET'),
      headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token },
      body: body ? JSON.stringify(body) : undefined
    }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || r.status); return j; }); });
  }
  function fail(e) { show('出错了：' + esc((e && (e.errMsg || e.message)) || JSON.stringify(e)), 'err'); }

  if (!window.h5sdk) { show('请在飞书客户端内打开。', 'err'); return; }

  var url = location.href.split('#')[0];
  fetch('/h5/jssdk-sign?url=' + encodeURIComponent(url)).then(function (r) { return r.json(); }).then(function (s) {
    window.h5sdk.error(fail);
    window.h5sdk.config({
      appId: s.appid, timestamp: +s.timestamp, nonceStr: s.noncestr, signature: s.signature,
      jsApiList: ['getBlockActionSourceDetail', 'requestAccess'],
      onSuccess: function () {}, onFail: fail
    });
    window.h5sdk.ready(function () {
      var lq = {};
      try { lq = JSON.parse(new URLSearchParams(location.search).get('bdp_launch_query') || '{}'); } catch (e) {}
      if (!lq.__trigger_id__) { show('请从消息的「更多 → 转为 Linear Issue」进入。', 'err'); return; }
      tt.requestAccess({
        appID: APP_ID, scopeList: [],
        success: function (r) {
          fetch('/h5/api/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: r.code }) })
            .then(function (x) { return x.json().then(function (j) { if (!x.ok) throw new Error(j.error); return j; }); })
            .then(function (sess) {
              token = sess.token;
              tt.getBlockActionSourceDetail({
                triggerCode: lq.__trigger_id__,
                success: function (res) { load(res.content && res.content.messages || []); },
                fail: fail
              });
            }).catch(fail);
        },
        fail: fail
      });
    });
  }).catch(fail);

  function load(messages) {
    show('正在读取消息…');
    api('/h5/api/prepare', { messages: messages }).then(function (d) { ctx = d; render(d); }).catch(fail);
  }

  var selLabels = {};
  function opts(list, sel) {
    return '<option value="">（无）</option>' + list.map(function (x) { return '<option value="' + esc(x.id) + '"' + (x.id === sel ? ' selected' : '') + '>' + esc(x.name) + '</option>'; }).join('');
  }
  function render(d) {
    var o = d.options;
    app.innerHTML =
      '<div class="quote">' + esc(d.preview) + '</div>' +
      (d.attachmentCount ? '<div class="hint">包含 ' + d.attachmentCount + ' 个图片/文件，将一并上传到 Issue。</div>' : '') +
      '<label>团队</label><select id="team">' + d.teams.map(function (t) { return '<option value="' + esc(t.id) + '"' + (t.id === o.teamId ? ' selected' : '') + '>' + esc(t.name) + '</option>'; }).join('') + '</select>' +
      '<label>标题</label><input type="text" id="title" value="' + esc(d.title) + '" />' +
      '<label>描述</label><textarea id="desc">' + esc(d.description) + '</textarea>' +
      '<div class="row"><div><label>项目</label><select id="project">' + opts(o.projects, d.defaults.projectId) + '</select></div>' +
      '<div><label>状态</label><select id="state">' + opts(o.states) + '</select></div></div>' +
      '<div class="row"><div><label>优先级</label><select id="prio"><option value="">（无）</option><option value="1">Urgent</option><option value="2">High</option><option value="3">Medium</option><option value="4">Low</option></select></div>' +
      '<div><label>模板</label><select id="tpl">' + opts(o.templates, d.defaults.templateId) + '</select></div></div>' +
      '<label>标签</label><div class="chips" id="labels">' + o.labels.map(function (l) { return '<span class="chip" data-id="' + esc(l.id) + '">' + esc(l.name) + '</span>'; }).join('') + '</div>' +
      '<label><input type="checkbox" id="sync" checked /> 同步此话题（回复 ↔ Issue 评论）</label>' +
      '<button id="go">创建 Issue</button><div id="out"></div>';
    selLabels = {};
    document.getElementById('labels').onclick = function (e) {
      var id = e.target.getAttribute && e.target.getAttribute('data-id');
      if (!id) return; selLabels[id] = !selLabels[id]; e.target.classList.toggle('on', selLabels[id]);
    };
    document.getElementById('team').onchange = function () {
      api('/h5/api/options?teamId=' + this.value).then(function (n) { ctx.options = n; var t = document.getElementById('title').value, ds = document.getElementById('desc').value; render(Object.assign({}, ctx, { title: t, description: ds, defaults: {} })); }).catch(fail);
    };
    document.getElementById('go').onclick = submit;
  }

  function submit() {
    var btn = document.getElementById('go'); btn.disabled = true; btn.textContent = '创建中…';
    var v = function (id) { return document.getElementById(id).value || undefined; };
    api('/h5/api/create', {
      messageIds: ctx.messageIds, chatId: ctx.chatId,
      teamId: v('team'), title: v('title'), description: v('desc'),
      projectId: v('project'), stateId: v('state'), templateId: v('tpl'),
      priority: v('prio') ? Number(v('prio')) : undefined,
      labelIds: Object.keys(selLabels).filter(function (k) { return selLabels[k]; }),
      sync: document.getElementById('sync').checked
    }).then(function (r) {
      app.innerHTML = '<div class="msg">✅ 已创建 <b>' + esc(r.identifier) + '</b>' + (r.synced ? '（已同步话题）' : '') + '<br/>' + esc(r.title) + '</div>' +
        '<button onclick="window.open(\\'' + esc(r.url) + '\\')">在 Linear 中打开</button>' +
        '<button class="sec" onclick="tt.closeWindow()">关闭</button>';
    }).catch(function (e) { btn.disabled = false; btn.textContent = '创建 Issue'; document.getElementById('out').innerHTML = '<div class="msg err">' + esc(e.message) + '</div>'; });
  }
})();
</script>
</body>
</html>`;
}
