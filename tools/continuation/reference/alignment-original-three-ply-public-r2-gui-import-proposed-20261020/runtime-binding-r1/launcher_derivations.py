"""Only retained launcher input/provenance assertions change; guards/timeout/spawn ownership stay."""


def derive(source, kind):
    changes = []
    newline = '\r\n' if '\r\n' in source else '\n'

    def replace(before, after):
        nonlocal source
        before = before.replace('\r\n', '\n').replace('\n', newline)
        after = after.replace('\r\n', '\n').replace('\n', newline)
        if source.count(before) != 1:
            raise ValueError('Missing/ambiguous launcher site: ' + before[:100])
        source = source.replace(before, after, 1)
        changes.append(dict(before=before, after=after))

    if kind == 'producer':
        replace("args:['-I','-B',recipe.producer]", "args:['-I','-B',recipe.producer,recipe.config]")
        begin = " const actual=JSON.parse(fs.readFileSync(recipe.nativeReceipt,'utf8'))"
        end = " const cleanup=JSON.parse(fs.readFileSync(recipe.cleanupReceipt,'utf8'))"
        if source.count(begin) != 1 or source.count(end) != 1:
            raise ValueError('Unique raw-producer assertions required')
        replace(source[source.index(begin):source.index(end)], """ const actual=JSON.parse(fs.readFileSync(recipe.nativeReceipt,'utf8')),item=actual.cases[0],expected=recipe.sourceInfo;
 assert.equal(actual.scope,'captured-public-input-native-controls-only');assert.equal(actual.cases.length,1);
 assert.equal(item.sourceFile,'ply-'+(recipe.source+1)+'.ply');assert.equal(item.vertices,expected.vertices);assert.equal(item.triangles,expected.triangles);
 assert.equal(item.verticesSha256,expected.originalIndexedPositions.sha256);assert.equal(item.trianglesSha256,expected.queryNormalAuthority.inputTriangles.sha256);
 assert.equal(actual.originalSourceCarrierReceipt.request.sha256,recipe.request.sha256);
 assert.equal(actual.originalSourceCarrierReceipt.entityId,expected.entityId);
 assert.equal(item.queries.length,33);assert.equal(item.indexOracleEstablishedByThisRun,true);assert.equal(actual.nativeAlignmentControllerExecuted,false);
 assert.equal(actual.nativeNormalCapture.sha256,item.vertexNormalsSha256);assert.equal(actual.nativeNormalCapture.bytes,expected.vertices*12);
 assert.equal(hash(actual.nativeNormalCapture.path),actual.nativeNormalCapture.sha256);assert(actual.peakRetainedBytes<=1536*1048576);
""")
    elif kind == 'controller':
        replace("['-I','-B',recipe.script],250000", "['-I','-B',recipe.script,recipe.config],250000")
        replace("phase('verify-original-ply-reference',process.execPath,[recipe.verifier,recipe.inputDescriptor,recipe.actualResult,recipe.comparisonReceipt],15000);",
                "const observed=JSON.parse(fs.readFileSync(recipe.actualResult,'utf8')),compared=JSON.parse(fs.readFileSync(recipe.comparisonReceipt,'utf8'));assert.equal(observed.nativeObservationOnly,true);assert.equal(observed.observedRequest.sha256,recipe.request.sha256);assert.equal(compared.status,'CONTROLLER_SCALARS_EXACT_GEOMETRY_UNCHECKED');assert.equal(compared.rawObservation.sha256,hash(recipe.actualResult));")
    elif kind == 'setter':
        replace('config.canonicalResult.path', 'config.actualControllerRaw.path')
        # Three independent references, all metadata sizing; no native numerical code.
        count = source.count('source.faces')
        if count != 3:
            raise ValueError('Exact retained setter face-count metadata sites required')
        before = source
        source = source.replace('source.faces', '(fs.statSync(source.trianglesCarrier).size/12)')
        changes.append(dict(before=before, after=source, scope='3 face-count metadata expressions'))
        replace('applicationCompared: false, physicalConvergenceParity: false,',
                "indexedFinalCompared: true, expandedRenderGeometryCompared: false, physicalConvergenceParity: false,")
        marker = "    assert.equal(fieldBytes, config.outputLimitBytes);"
        replace(marker, marker + "\n    const final=JSON.parse(fs.readFileSync(path.join(config.outputDirectory,'public-final-indexed-comparison.json'),'utf8'));assert.equal(final.status,'FINAL_INDEXED_POSITION_AUTHORED_NORMAL_FIELDS_EXACT');assert.equal(final.fieldCount,6);assert.equal(final.bytes,config.sources.reduce((sum,s)=>sum+s.count*24,0));")
    else:
        raise ValueError('Unknown exact retained launcher')
    inverse = source
    for change in reversed(changes):
        if inverse.count(change['after']) != 1:
            raise ValueError('Ambiguous launcher source inverse')
        inverse = inverse.replace(change['after'], change['before'], 1)
    return source, changes, inverse
