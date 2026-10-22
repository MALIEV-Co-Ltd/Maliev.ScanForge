import assert from 'node:assert/strict';

export async function importOriginalPlyViaGui({sources,page,call,waitUntil,check,onImportStage=async()=>{}}){
  assert.equal(sources.length,3);
  const input=page.locator('input[type="file"][multiple][accept*=".ply"]');
  assert.equal(await input.count(),1,'Exact existing public scan file input');
  const reports=[];
  for(let i=0;i<3;i++){
    check();const source=sources[i];
    assert.equal(source.name,`ply-${i+1}.ply`);assert.equal(source.path,`B:/temp/alignment-example-files/${source.name}`);
    assert(/^[a-f0-9]{64}$/.test(source.sha256));assert(Number.isSafeInteger(source.bytes)&&source.bytes>0);
    const before=(await call('project_get')).result;assert.equal(before.objects.length,i);
    await onImportStage({sourceIndex:i,stage:'begin'});
    // Paths, one at a time: Playwright drives the actual GUI input; no artifact cap bypass.
    await input.setInputFiles(source.path);
    await onImportStage({sourceIndex:i,stage:'after-file-input'});
    const dialog=page.getByRole('dialog',{name:'Import scan',exact:true});await dialog.waitFor();
    await onImportStage({sourceIndex:i,stage:'after-dialog'});
    assert.equal(await dialog.locator('select').inputValue(),'mm','Fresh public import dialog default millimetres');
    await dialog.getByRole('button',{name:'Import',exact:true}).click();
    await dialog.waitFor({state:'hidden'});
    await waitUntil(async()=>{
      check();const project=(await call('project_get')).result;
      assert(project.objects.length<=i+1,'GUI import created excess authored entities');
      if(project.objects.length!==i+1)return false;
      assert.equal(project.objects.filter(object=>object.name===source.name).length,1,'Exact original PLY, no sampled preview');
      return (await call('session_get')).result.busy===false;
    },`public GUI import ${source.name}`,60000);
    await onImportStage({sourceIndex:i,stage:'after-publication'});
    reports.push({sourceId:String(i),name:source.name,bytes:source.bytes,sha256:source.sha256,publicImportCompleted:true,route:'GUI setInputFiles + Import scan mm',placement:'Unchanged public placeAtOrigin:true'});
  }
  return reports;
}
