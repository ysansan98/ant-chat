export const visualizationRuntimeSource = String.raw`
(function () {
  'use strict';
  var port = null;
  var artifactId = '';
  var gestureExpiresAt = 0;
  var gestureWindowMs = 1500;
  var themeStyle = null;

  function clampHeight(value) {
    return Math.min(1200, Math.max(96, Math.round(Number.isFinite(value) ? value : 240)));
  }

  function getThemeStyle() {
    if (themeStyle && themeStyle.isConnected) return themeStyle;
    themeStyle = document.getElementById('ant-chat-viz-theme');
    return themeStyle;
  }

  function sanitizeCssValue(value) {
    return String(value).replace(/[{};]/g, '');
  }

  function setTheme(theme) {
    if (!theme || !theme.tokens) return;
    var root = document.documentElement;
    root.dataset.theme = theme.mode;
    var themeElement = getThemeStyle();
    if (!themeElement) return;
    var declarations = Object.keys(theme.tokens).map(function (key) {
      var cssName = '--viz-' + key.replace(/[A-Z]/g, function (letter) { return '-' + letter.toLowerCase(); });
      return cssName + ':' + sanitizeCssValue(theme.tokens[key]);
    });
    declarations.push('--viz-mode:' + theme.mode, 'color-scheme:' + theme.mode);
    themeElement.textContent = ':root{' + declarations.join(';') + ';}';
    reportResize();
  }

  function reportResize() {
    if (!port) return;
    var body = document.body;
    var root = document.documentElement;
    port.postMessage({ type: 'resize', height: clampHeight(Math.max(body ? body.scrollHeight : 0, root.scrollHeight)) });
  }

  function nextRequestId() {
    return 'request-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
  }

  function sendFollowUpMessage(input) {
    if (Date.now() > gestureExpiresAt)
      return Promise.reject(new Error('必须由真实用户交互触发提交'));
    if (!port || !input || typeof input.prompt !== 'string' || !input.prompt.trim() || input.prompt.length > 4000)
      return Promise.reject(new Error('follow-up 请求无效'));
    var request = { type: 'follow-up-request', requestId: nextRequestId(), artifactId: artifactId, prompt: input.prompt };
    if (typeof input.title === 'string' && input.title.length > 0) request.title = input.title.slice(0, 250);
    gestureExpiresAt = 0;
    port.postMessage(request);
    return Promise.resolve();
  }

  window.antChatVisualization = Object.freeze({ sendFollowUpMessage: sendFollowUpMessage });
  document.addEventListener('click', function (event) { if (event.isTrusted) gestureExpiresAt = Date.now() + gestureWindowMs; }, true);
  document.addEventListener('submit', function (event) { if (event.isTrusted) gestureExpiresAt = Date.now() + gestureWindowMs; }, true);

  function connect(event) {
    if (event.source !== window || event.data?.type !== 'visualization-connect' || !event.ports?.[0]) return;
    port = event.ports[0];
    port.onmessage = function (messageEvent) {
      var message = messageEvent.data;
      if (message?.type === 'init') { artifactId = message.artifactId; setTheme(message.theme); port.postMessage({ type: 'ready' }); reportResize(); }
      else if (message?.type === 'theme') setTheme(message.theme);
    };
    port.start();
  }

  window.addEventListener('message', connect);
  window.addEventListener('resize', reportResize);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(reportResize).observe(document.documentElement);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reportResize, { once: true });
  else reportResize();
})();
`
