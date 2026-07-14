/**
 * First-party runtime source. It receives only a validated JSON spec over a
 * MessagePort and creates a small allow-listed DOM/SVG tree; it never parses
 * or evaluates model-provided markup, styles, scripts, URLs, or expressions.
 */
export const visualizationRuntimeSource = String.raw`
(function () {
  'use strict';
  var port = null;
  var artifactId = '';
  var spec = null;
  var theme = {};
  var values = {};
  var state = {};
  var playerTimers = {};
  var root = null;

  function node(tag, text) {
    var element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function attr(element, name, value) {
    if (value !== undefined && value !== null) element.setAttribute(name, String(value));
    return element;
  }
  function send(message) {
    if (port) port.postMessage(message);
  }
  function expressionValue(expression, row) {
    if (!expression) return null;
    if (expression.type === 'literal') return expression.value;
    if (expression.type === 'data') return row && row[expression.field || ''];
    if (expression.type === 'state') return state[expression.key];
    if (expression.type === 'not') return !Boolean(expressionValue(expression.operand, row));
    if (expression.type === 'and' || expression.type === 'or') {
      var operands = expression.operands.map(function (item) { return Boolean(expressionValue(item, row)); });
      return expression.type === 'and' ? operands.every(Boolean) : operands.some(Boolean);
    }
    if (expression.type === 'eq' || expression.type === 'neq' || expression.type === 'gt' || expression.type === 'gte' || expression.type === 'lt' || expression.type === 'lte') {
      var left = expressionValue(expression.left, row); var right = expressionValue(expression.right, row);
      if (expression.type === 'eq') return left === right;
      if (expression.type === 'neq') return left !== right;
      if (expression.type === 'gt') return left > right;
      if (expression.type === 'gte') return left >= right;
      if (expression.type === 'lt') return left < right;
      return left <= right;
    }
    if (expression.type === 'add' || expression.type === 'subtract' || expression.type === 'multiply' || expression.type === 'divide') {
      var a = numberValue(expressionValue(expression.left, row)); var b = numberValue(expressionValue(expression.right, row));
      if (expression.type === 'add') return a + b;
      if (expression.type === 'subtract') return a - b;
      if (expression.type === 'multiply') return a * b;
      return b === 0 ? 0 : a / b;
    }
    if ((expression.type === 'sum' || expression.type === 'avg') && spec && spec.data) {
      var source = Array.isArray(spec.data[expression.dataset]) ? spec.data[expression.dataset] : [];
      var selected = expression.filter ? source.filter(function (item) { return Boolean(expressionValue(expression.filter, item)); }) : source;
      var total = selected.reduce(function (sum, item) { return sum + numberValue(item[expression.field]); }, 0);
      return expression.type === 'avg' && selected.length ? total / selected.length : total;
    }
    return null;
  }
  function rowsFor(view) {
    if (Array.isArray(view.data)) return view.data;
    if (typeof view.dataset === 'string' && spec && spec.data) return Array.isArray(spec.data[view.dataset]) ? spec.data[view.dataset] : [];
    if (typeof view.data === 'string' && spec && spec.data) return Array.isArray(spec.data[view.data]) ? spec.data[view.data] : [];
    return [];
  }
  function setTheme(next) {
    var tokens = next && next.tokens ? next.tokens : (next || {});
    theme = Object.assign({}, next || {}, tokens);
    if (!root) return;
    root.style.setProperty('--viz-background', theme.background || 'transparent');
    root.style.setProperty('--viz-foreground', theme.foreground || 'currentColor');
    root.style.setProperty('--viz-card', theme.card || 'transparent');
    root.style.setProperty('--viz-border', theme.border || 'currentColor');
    root.style.setProperty('--viz-muted', theme.mutedForeground || 'currentColor');
    root.style.setProperty('--viz-primary', theme.primary || 'currentColor');
    root.style.setProperty('--viz-primary-foreground', theme.primaryForeground || 'inherit');
    root.style.setProperty('--viz-destructive', theme.destructive || 'currentColor');
    ['chart1', 'chart2', 'chart3', 'chart4', 'chart5'].forEach(function (key, index) { root.style.setProperty('--viz-series-' + (index + 1), theme[key] || 'currentColor'); });
    document.documentElement.style.colorScheme = theme.mode || 'light';
  }
  function resize() {
    var height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight, 96);
    send({ type: 'resize', height: Math.min(1200, height) });
  }
  function textLabel(value) { return value === null || value === undefined ? '' : String(value); }
  function numberValue(value) { return typeof value === 'number' && isFinite(value) ? value : Number(value) || 0; }
  function titleFor(view, fallback) { return view.title ? node('h3', view.title) : node('span', fallback || ''); }
  function viewRows(view) { return rowsFor(view).filter(function (row) { return row && typeof row === 'object' && (!view.filter || Boolean(expressionValue(view.filter, row))); }); }

  function renderChart(view) {
    var section = node('section');
    section.className = 'viz-section';
    if (view.title) section.appendChild(titleFor(view));
    if (view.summary) section.appendChild(node('p', view.summary));
    var rows = viewRows(view);
    if (!rows.length) { section.appendChild(node('p', '暂无数据')); return section; }
    var category = view.x || view.category || 'label';
    var rawValue = view.y || view.value || 'value';
    var valueKeys = Array.isArray(rawValue) ? rawValue : [rawValue];
    var max = Math.max.apply(null, rows.flatMap(function (row) { return valueKeys.map(function (key) { return numberValue(row[key]); }); }).concat([1]));
    var svg = attr(node('svg'), 'viewBox', '0 0 720 280');
    attr(svg, 'role', 'img');
    attr(svg, 'aria-label', view.title || '数据图表');
    var axis = attr(node('line'), 'x1', 48); attr(axis, 'y1', 236); attr(axis, 'x2', 700); attr(axis, 'y2', 236); axis.setAttribute('stroke', 'var(--viz-border)'); svg.appendChild(axis);
    rows.slice(0, 80).forEach(function (row, index) {
      var baseX = 64 + index * (620 / Math.max(rows.length, 1));
      var label = node('text', textLabel(row[category])); attr(label, 'x', baseX); attr(label, 'y', 258); attr(label, 'text-anchor', 'middle'); label.setAttribute('fill', 'var(--viz-muted)'); svg.appendChild(label);
      valueKeys.forEach(function (valueKey, seriesIndex) {
        var value = numberValue(row[valueKey]); var x = baseX + (seriesIndex - (valueKeys.length - 1) / 2) * 18; var pointY = 220 - (value / max) * 170; var color = 'var(--viz-series-' + (seriesIndex % 5 + 1) + ')';
        if (view.type === 'bar' || view.type === 'stacked-bar') {
          var rect = node('rect'); attr(rect, 'x', x - 8); attr(rect, 'y', pointY); attr(rect, 'width', 16); attr(rect, 'height', Math.max(0, 220 - pointY)); attr(rect, 'rx', 4); rect.setAttribute('fill', color); rect.setAttribute('opacity', '0.82'); svg.appendChild(rect);
        } else if (view.type === 'scatter') {
          var circle = node('circle'); attr(circle, 'cx', x); attr(circle, 'cy', pointY); attr(circle, 'r', 5); circle.setAttribute('fill', color); svg.appendChild(circle);
        } else {
          var point = node('circle'); attr(point, 'cx', x); attr(point, 'cy', pointY); attr(point, 'r', 4); point.setAttribute('fill', color); svg.appendChild(point);
          if (index > 0) { var previous = rows[index - 1]; var previousX = 64 + (index - 1) * (620 / Math.max(rows.length, 1)) + (seriesIndex - (valueKeys.length - 1) / 2) * 18; var previousY = 220 - (numberValue(previous[valueKey]) / max) * 170; var line = node('line'); attr(line, 'x1', previousX); attr(line, 'y1', previousY); attr(line, 'x2', x); attr(line, 'y2', pointY); line.setAttribute('stroke', color); attr(line, 'stroke-width', 3); svg.appendChild(line); }
        }
      });
    });
    section.appendChild(svg);
    if (view.unit) section.appendChild(node('p', '单位：' + view.unit));
    return section;
  }

  function renderTable(view) {
    var section = node('section'); section.className = 'viz-section';
    if (view.title) section.appendChild(titleFor(view));
    var rows = viewRows(view); var table = node('table');
    var keys = view.columns && view.columns.length ? view.columns.map(function (column) { return column.key; }) : Object.keys(rows[0] || {});
    var head = node('tr'); keys.forEach(function (key) { var column = (view.columns || []).find(function (item) { return item.key === key; }); head.appendChild(node('th', column ? column.label : key)); }); table.appendChild(head);
    rows.slice(0, 200).forEach(function (row) { var tr = node('tr'); keys.forEach(function (key) { tr.appendChild(node('td', textLabel(row[key]))); }); table.appendChild(tr); });
    section.appendChild(table); return section;
  }

  function renderList(view) {
    var section = node('section'); section.className = 'viz-section';
    if (view.title) section.appendChild(titleFor(view));
    var list = node('ol');
    viewRows(view).slice(0, 200).forEach(function (row) {
      var label = textLabel(row[view.label || view.category || 'label'] || row.title || row.name);
      var time = textLabel(row[view.start] || '') + (view.end ? ' - ' + textLabel(row[view.end] || '') : '');
      var lane = view.type === 'swimlane' ? ' [' + textLabel(row[view.lane] || '') + ']' : '';
      list.appendChild(node('li', label + (time.trim() ? ' · ' + time : '') + lane));
    });
    section.appendChild(list); return section;
  }

  function renderTimeline(view) {
    var section = node('section'); section.className = 'viz-section';
    if (view.title) section.appendChild(titleFor(view));
    var track = node('ol'); track.className = 'viz-timeline';
    viewRows(view).slice(0, 200).forEach(function (row) {
      var item = node('li'); item.className = 'viz-timeline-item';
      var marker = node('span'); marker.className = 'viz-timeline-marker'; marker.setAttribute('aria-hidden', 'true');
      var body = node('div'); body.className = 'viz-timeline-card';
      body.appendChild(node('strong', textLabel(row[view.label] || '事件')));
      body.appendChild(node('span', textLabel(row[view.start] || '') + (view.end ? ' - ' + textLabel(row[view.end] || '') : '')));
      item.appendChild(marker); item.appendChild(body); track.appendChild(item);
    });
    section.appendChild(track); return section;
  }

  function renderSwimlane(view) {
    var section = node('section'); section.className = 'viz-section';
    if (view.title) section.appendChild(titleFor(view));
    var lanes = {};
    viewRows(view).slice(0, 200).forEach(function (row) {
      var lane = textLabel(row[view.lane] || '未分类');
      if (!lanes[lane]) lanes[lane] = [];
      lanes[lane].push(row);
    });
    Object.keys(lanes).forEach(function (lane) {
      var laneNode = node('section'); laneNode.className = 'viz-swimlane';
      laneNode.appendChild(node('h4', lane));
      var track = node('ol'); track.className = 'viz-swimlane-track';
      lanes[lane].forEach(function (row) {
        var item = node('li'); item.className = 'viz-swimlane-card';
        item.appendChild(node('strong', textLabel(row[view.label] || '任务')));
        item.appendChild(node('span', textLabel(row[view.start] || '') + ' - ' + textLabel(row[view.end] || '')));
        track.appendChild(item);
      });
      laneNode.appendChild(track); section.appendChild(laneNode);
    });
    return section;
  }

  function renderFlow(view) {
    var section = node('section'); section.className = 'viz-section';
    if (view.title) section.appendChild(titleFor(view));
    var status = node('p', '请选择节点'); status.setAttribute('aria-live', 'polite'); section.appendChild(status);
    var nodes = Array.isArray(view.nodes) ? view.nodes : (Array.isArray(view.states) ? view.states : viewRows(view));
    var lane = node('div'); lane.className = 'viz-flow';
    nodes.slice(0, 100).forEach(function (item, index) {
      var label = item.label || item.title || item.name || item.id || ('步骤 ' + (index + 1));
      var button = node('button', label); button.type = 'button';
      button.addEventListener('click', function () { state[view.id || 'active-node'] = item.id || label; status.textContent = '当前节点：' + label; });
      lane.appendChild(button);
      if (index < nodes.length - 1) lane.appendChild(node('span', '→'));
    });
    section.appendChild(lane);
    return section;
  }

  function renderPlayer(view) {
    var section = node('section'); section.className = 'viz-section';
    if (view.title) section.appendChild(titleFor(view));
    var steps = Array.isArray(view.steps) ? view.steps : viewRows(view); var index = 0;
    var current = node('p'); current.setAttribute('aria-live', 'polite');
    var renderCurrent = function () { var step = steps[index] || {}; current.textContent = textLabel(step.label || step.title || step.description || step.name || ('步骤 ' + (index + 1))) + '（' + (index + 1) + '/' + Math.max(steps.length, 1) + '）'; };
    renderCurrent(); section.appendChild(current);
    var controls = node('div'); controls.className = 'viz-controls';
    var previous = node('button', '上一步'); previous.type = 'button';
    var next = node('button', '下一步'); next.type = 'button';
    var play = node('button', '播放'); play.type = 'button';
    var reset = node('button', '重置'); reset.type = 'button';
    var stop = function () { if (playerTimers[view.id || view.title || 'player']) { clearInterval(playerTimers[view.id || view.title || 'player']); delete playerTimers[view.id || view.title || 'player']; play.textContent = '播放'; } };
    previous.addEventListener('click', function () { stop(); index = Math.max(0, index - 1); renderCurrent(); resize(); });
    next.addEventListener('click', function () { stop(); index = Math.min(Math.max(steps.length - 1, 0), index + 1); renderCurrent(); resize(); });
    reset.addEventListener('click', function () { stop(); index = 0; renderCurrent(); resize(); });
    play.addEventListener('click', function () {
      var key = view.id || view.title || 'player';
      if (playerTimers[key]) { stop(); return; }
      play.textContent = '暂停';
      playerTimers[key] = setInterval(function () { if (index >= steps.length - 1) { stop(); return; } index += 1; renderCurrent(); resize(); }, 900);
    });
    controls.appendChild(previous); controls.appendChild(play); controls.appendChild(next); controls.appendChild(reset); section.appendChild(controls); return section;
  }

  function initialValue(field) {
    if (field.initial !== undefined) return field.initial;
    if (field.type === 'checkbox' || field.type === 'toggle') return false;
    if (field.type === 'range') return field.min !== undefined ? field.min : 0;
    return '';
  }
  function optionsFor(field) { return Array.isArray(field.options) ? field.options : []; }
  function fieldValue(field, input) {
    if (field.type === 'checkbox' || field.type === 'toggle') return Boolean(input.checked);
    if (field.type === 'range') return Number(input.value);
    return input.value;
  }
  function validateForm(fields, error) {
    for (var i = 0; i < fields.length; i += 1) {
      var field = fields[i]; var value = values[field.id];
      if (field.required && (value === '' || value === null || value === undefined || value === false)) { error.textContent = field.label + '为必填项'; return false; }
      if (typeof value === 'number' && ((field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) { error.textContent = field.label + '超出范围'; return false; }
    }
    error.textContent = ''; return true;
  }
  function renderForm(view) {
    var section = node('section'); section.className = 'viz-section';
    if (view.title) section.appendChild(titleFor(view));
    var form = node('form'); var fields = Array.isArray(view.fields) ? view.fields : [];
    fields.forEach(function (field) {
      if (values[field.id] === undefined) values[field.id] = initialValue(field);
      var label = node('label', field.label); var id = 'field-' + field.id; label.setAttribute('for', id);
      var input;
      if (field.type === 'textarea') input = node('textarea');
      else if (field.type === 'select') { input = node('select'); optionsFor(field).forEach(function (option) { var item = typeof option === 'string' ? { label: option, value: option } : option; var optionNode = node('option', item.label); optionNode.value = item.value; input.appendChild(optionNode); }); }
      else { input = node('input'); input.type = field.type === 'toggle' ? 'checkbox' : field.type; }
      input.id = id; input.name = field.id; if (field.placeholder) input.placeholder = field.placeholder; input.value = field.type === 'range' ? String(values[field.id]) : (typeof values[field.id] === 'string' ? values[field.id] : '');
      if (field.type === 'checkbox' || field.type === 'toggle') input.checked = Boolean(values[field.id]);
      if (field.min !== undefined) input.min = String(field.min); if (field.max !== undefined) input.max = String(field.max); if (field.step !== undefined) input.step = String(field.step);
      input.addEventListener('input', function () { values[field.id] = fieldValue(field, input); }); input.addEventListener('change', function () { values[field.id] = fieldValue(field, input); });
      label.appendChild(input); form.appendChild(label);
    });
    var error = node('p'); error.className = 'viz-error'; error.setAttribute('aria-live', 'polite'); form.appendChild(error);
    var action = spec.actions && spec.actions.find(function (item) { return item.id === (view.actionId || (spec.actions[0] && spec.actions[0].id)); });
    if (action) { var submit = node('button', view.submitLabel || action.label || '提交'); submit.type = 'submit'; form.appendChild(submit); }
    form.addEventListener('submit', function (event) { event.preventDefault(); fields.forEach(function (field) { var input = form.querySelector('#field-' + field.id); if (input) values[field.id] = fieldValue(field, input); }); if (!validateForm(fields, error) || !action) return; send({ type: 'follow-up-request', requestId: String(Date.now()) + '-' + Math.random().toString(36).slice(2), artifactId: artifactId, actionId: action.id, values: Object.assign({}, values) }); });
    section.appendChild(form); return section;
  }

  function renderView(view) {
    if (view.type === 'line' || view.type === 'bar' || view.type === 'area' || view.type === 'scatter' || view.type === 'stacked-bar') return renderChart(view);
    if (view.type === 'table' || view.type === 'grid' || view.type === 'category-grid') return renderTable(view);
    if (view.type === 'timeline') return renderTimeline(view);
    if (view.type === 'swimlane') return renderSwimlane(view);
    if (view.type === 'flow' || view.type === 'state-machine') return renderFlow(view);
    if (view.type === 'player') return renderPlayer(view);
    if (view.type === 'form') return renderForm(view);
    return node('p', '不支持的可视化视图');
  }
  function render() {
    if (!spec) return;
    root.replaceChildren();
    root.style.display = spec.layout && spec.layout.type === 'grid' ? 'grid' : 'block';
    root.style.gridTemplateColumns = spec.layout && spec.layout.type === 'grid' ? 'repeat(' + spec.layout.columns + ', minmax(0, 1fr))' : '';
    root.style.gap = (spec.layout && spec.layout.gap !== undefined ? spec.layout.gap : 16) + 'px';
    root.setAttribute('aria-label', spec.title || '可视化');
    var heading = node('h2', spec.title); root.appendChild(heading);
    if (spec.summary) root.appendChild(node('p', spec.summary));
    (spec.views || []).forEach(function (view) { root.appendChild(renderView(view)); });
    setTheme(theme); resize();
  }
  function handleMessage(message) {
    if (!message || typeof message !== 'object') return;
    if (message.type === 'init' && message.spec && message.spec.version === 1) { artifactId = message.artifactId; spec = message.spec; setTheme(message.theme); render(); return; }
    if (message.type === 'theme') { setTheme(message.theme); return; }
    if (message.type === 'follow-up-result') { var status = document.querySelector('.viz-error'); if (status) status.textContent = message.accepted ? '已提交' : '提交未确认'; }
  }
  window.addEventListener('message', function (event) {
    if (event.source !== window.parent || !event.data || event.data.type !== 'visualization-connect' || !event.ports || event.ports.length !== 1 || !event.ports[0]) return;
    port = event.ports[0]; port.onmessage = function (messageEvent) { handleMessage(messageEvent.data); }; if (port.start) port.start(); send({ type: 'ready' });
  });
  root = node('main'); root.className = 'viz-root'; document.body.appendChild(root);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(resize).observe(root);
})();
`
