import assert from 'node:assert/strict';
import test from 'node:test';
import 'fake-indexeddb/auto';
import {loadLiveWorkspace, readLayoutFile, makeLayoutFile, defaultChartView} from '../src/lib/live-layouts.ts';
import {listLiveLayouts, saveLiveLayout, deleteLiveLayout} from '../src/lib/storage.ts';

test('a saved layout restores the migrated workspace, styling, camera, drawings and Pine inputs on another device', async () => {
  const drawing = {id: 'old-line', kind: 'hline', points: [{time: 1700000000, price: 2000}], locked: true};
  const workspace = loadLiveWorkspace({period: '15m', studies: ['rsi14'], lengths: {rsi14: 9}, drawings: [drawing]});
  assert.equal(workspace.appearance.background, '#0d141e');
  workspace.appearance.background = '#ffffff';
  workspace.scripts.push({id: crypto.randomUUID(), name: 'Custom',
    source: '//@version=6\nindicator("Custom")\nplot(close)', enabled: true, inputs: {in_0: 14}});
  const view = {...defaultChartView, follow: false, viewport: {time: 1700000200, span: 77}, priceRange: {from: 1980, to: 2040}};
  const file = makeLayoutFile('กราฟทอง', workspace, view);
  const saved = await saveLiveLayout(file);
  workspace.drawings.length = 0;
  workspace.scripts.length = 0;
  const [record] = await listLiveLayouts();
  const restored = readLayoutFile(JSON.parse(JSON.stringify(record.file)));
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
