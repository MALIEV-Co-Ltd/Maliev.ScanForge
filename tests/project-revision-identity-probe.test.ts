import { expect, it } from 'vitest';
import { ApplicationApi, type WorkspaceHost, type WorkspaceSnapshot } from '../src/automation/api';

it('shows workspace revision tracks geometry identity rather than in-place writes', () => {
  const positions = [1,0,0,0,1,0,0,0,1];
  const entity = { id:'a', name:'a', kind:'mesh', positions, color:'#fff', opacity:1, visible:true } as any;
  const state = { name:'test', entities:[entity], history:[], future:[], authoring:{}, selectedId:null, selection:null, settings:{} } as WorkspaceSnapshot;
  const host = { snapshot: () => state } as WorkspaceHost;
  const api = new ApplicationApi(host, {});
  try {
    const before = api.currentRevision();
    positions[0] = 999;
    expect(api.currentRevision()).toBe(before);
    entity.positions = positions.slice();
    expect(api.currentRevision()).toBe(before + 1);
  } finally { api.dispose(); }
});
