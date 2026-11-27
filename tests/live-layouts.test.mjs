import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';
import {loadLiveWorkspace, readLayoutFile, makeLayoutFile, defaultChartView} from '../src/lib/live-layouts.ts';
import {listLiveLayouts, saveLiveLayout, deleteLiveLayout} from '../src/lib/storage.ts';

test('a saved layout restores the migrated workspace, styling, camera, drawings and Pine inputs on another device', async () => {
  const drawing = {id: 'old-line', kind: 'hline', points: [{time: 1700000000, price: 2000}], locked: true};
  const workspace = loadLiveWorkspace({period: '15m', studies: ['rsi14'], lengths: {rsi14: 9}, drawings: [drawing]});
  assert.equal(workspace.chartLayout, 'single');
  assert.equal(workspace.favoriteCollapsed, false);
  workspace.chartLayout = 'six';
  workspace.favoriteCollapsed = true;
  workspace.favoriteSize = 'large';
  workspace.favoriteTools = ['hline', 'fib'];
  assert.equal(workspace.appearance.background, '#0d141e');
  workspace.appearance.background = '#ffffff';
  workspace.scripts.push({id: crypto.randomUUID(), name: 'Custom',
    source: '//@version=6\nindicator("Custom")\nplot(close)', enabled: true, inputs: {in_0: 14}});
  workspace.hiddenStudies = ['live-rsi14', workspace.scripts[0].id];
  const view = {...defaultChartView, follow: false, viewport: {time: 1700000200, span: 77}, priceRange: {from: 1980, to: 2040}};
  const file = makeLayoutFile('กราฟทอง', workspace, view);
  const saved = await saveLiveLayout(file);
  workspace.drawings.length = 0;
  workspace.scripts.length = 0;
  const [record] = await listLiveLayouts();
  const restored = readLayoutFile(JSON.parse(JSON.stringify(record.file)));
  assert.equal(restored.workspace.chartLayout, 'six');
  assert.equal(restored.workspace.favoriteCollapsed, true);
  assert.equal(restored.workspace.favoriteSize, 'large');
  assert.deepEqual(restored.workspace.favoriteTools, ['hline', 'fib']);
  const {chartLayout, favoriteCollapsed, favoriteSize, hiddenStudies, ...legacyWorkspace} = restored.workspace;
  assert.deepEqual(hiddenStudies, ['live-rsi14', restored.workspace.scripts[0].id]);
  assert.deepEqual(readLayoutFile({...restored, workspace: legacyWorkspace}).workspace.hiddenStudies, []);
  assert.equal(readLayoutFile({...restored, workspace: legacyWorkspace}).workspace.favoriteCollapsed, false);
  assert.equal(readLayoutFile({...restored, workspace: legacyWorkspace}).workspace.favoriteSize, 'medium');
  assert.equal(readLayoutFile({...restored, workspace: legacyWorkspace}).workspace.chartLayout, 'single');
  assert.deepEqual(restored.workspace.drawings, [drawing]);
  assert.equal(restored.workspace.appearance.background, '#ffffff');
  assert.equal(restored.workspace.scripts[0].inputs.in_0, 14);
  assert.equal(restored.workspace.lengths.rsi14, 9);
  assert.deepEqual(restored.view, view);
  assert.throws(() => readLayoutFile({...restored, version: 88}));
  const updated = await saveLiveLayout({...restored, name: 'อีกชื่อ'}, saved);
  await assert.rejects(saveLiveLayout(restored, saved), /เปลี่ยน/);
  await assert.rejects(deleteLiveLayout(saved), /เปลี่ยน/);
  assert.equal((await listLiveLayouts())[0].file.name, 'อีกชื่อ');
  await deleteLiveLayout(updated);
  assert.equal((await listLiveLayouts()).length, 0);
});

test('exported Live drawings preserve observed Forward Test times and leave old positions inactive', () => {
  const points = [2350, 2360, 2345].map((price, i) => ({time:1700000000+i*60, price}));
  const checked = {id:'forward-long', kind:'long', points, forwardTest:{
    plan:{side:'long',entry:2350,tp:2360,sl:2345}, approach:'above', after:1700000200,
    entry:{time:1700000100,price:2350}, exit:{kind:'tp',time:1700000200,price:2360.2},
  }};
  const older = {id:'untracked-long', kind:'long', points};
  const file = makeLayoutFile('ตัวอย่าง Forward Test', loadLiveWorkspace({drawings:[checked,older]}), defaultChartView);
  const restored = readLayoutFile(JSON.parse(JSON.stringify(file)));
  assert.deepEqual(restored.workspace.drawings, [checked,older]);
});

test('saved drawings keep indicator pane coordinates, grouping, visibility and scope', () => {
  const drawing = {id:'macd-level',kind:'hline',pane:'macd',scope:'chart',chartPeriod:'15m',
    group:'Oscillators',hidden:true,points:[{time:1700000000,price:-.25}]};
  const pinned = {id:'note',kind:'anchoredNote',scope:'global',text:'Review',
    points:[{time:1700000000,price:2400,screen:{x:.28,y:.4}}]};
  const workspace=loadLiveWorkspace({drawings:[drawing,pinned]});
  const file=makeLayoutFile('Indicators',workspace,defaultChartView);
  assert.deepEqual(readLayoutFile(JSON.parse(JSON.stringify(file))).workspace.drawings,[drawing,pinned]);
});
