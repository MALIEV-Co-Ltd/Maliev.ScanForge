import { readFileSync, writeFileSync } from "node:fs";
import { expect, it } from "vitest";
import { parseMesh } from "../src/io";
import { runScanEdit } from "../src/scan-edit";

it("reports retained native Split facet and vertex differences", () => {
  const results: unknown[] = [];
  for (const [kind, source, cutter, native] of [
    ["convex", "m2-native-convex-split-20261029/square-source.stl", "m2-native-convex-split-20261029/convex-cutter.stl", "m2-native-convex-split-20261029/native-convex-result-20261029.stl"],
    ["concave", "m2-native-concave-split-20261029/square-source.stl", "m2-native-concave-split-20261029/concave-cutter.stl", "m2-native-concave-split-20261029/native-concave-result-20261029.stl"],
    ["cyclic", "m2-native-cyclic-split-20261029/square-source-cyclic.stl", "m2-native-cyclic-split-20261029/convex-cutter.stl", "m2-native-cyclic-split-20261029/native-convex-cyclic-result-20261029.stl"],
  ]) {
    const read = (name:string) => {const b=readFileSync(new URL(`./fixtures/${name}`,import.meta.url));return parseMesh(b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),"stl");};
    const target=read(cutter), positions=read(source), expected=read(native);
    const actual=runScanEdit({kind:"scanEdit",action:"split",positions,target}).positions!;
    const vectors=(p:ArrayLike<number>)=>Array.from({length:p.length/3},(_,i)=>[0,1,2].map(j=>Math.fround(p[3*i+j])));
    const points=(p:ArrayLike<number>)=>new Map(vectors(p).map(v=>[v.join(","),v]));
    const faces=(p:ArrayLike<number>)=>Array.from({length:p.length/9},(_,i)=>vectors(Array.from({length:9},(_,j)=>p[i*9+j])).map(v=>v.join(",")).sort().join("|"));
    const a=points(actual), b=points(expected), af=faces(actual), bf=faces(expected);
    const diff=(x:Map<string,number[]>, y:Map<string,number[]>)=>[...x].filter(([k])=>!y.has(k)).map(([,v])=>({point:v,nearest:Math.min(...[...y.values()].map(w=>Math.hypot(...v.map((q,i)=>q-w[i]))))}));
    const subtract=(x:string[],y:string[])=>{const counts=new Map<string,number>();for(const f of y)counts.set(f,(counts.get(f)??0)+1);return x.filter(f=>{const n=counts.get(f)??0;if(!n)return true;counts.set(f,n-1);return false;});};
    const extraVertices=diff(a,b),missingVertices=diff(b,a),extraFaces=subtract(af,bf),missingFaces=subtract(bf,af);
    expect(extraVertices).toEqual([]);
    expect(missingVertices).toEqual([]);
    expect(af.length).toEqual(bf.length);
    expect(extraFaces).toHaveLength(({convex:6,concave:12,cyclic:8} as Record<string,number>)[kind]);
    expect(missingFaces).toHaveLength(extraFaces.length);
    results.push({kind, actualFaces:af.length,nativeFaces:bf.length,actualVertices:a.size,nativeVertices:b.size,extraVertices,missingVertices,extraFaces,missingFaces});
  }
  writeFileSync("C:/Users/Shoung/Documents/Codex/2026-10-22/clo/work/m2-current-native-facet-diff-20261029.json",JSON.stringify(results,null,2));
});
