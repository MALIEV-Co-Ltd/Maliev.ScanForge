import { BufferAttribute, BufferGeometry } from "three";
import { MeshBVH } from "three-mesh-bvh";
self.onmessage = ({ data }) => {
  const geometry = new BufferGeometry();
  try {
    geometry.setAttribute("position", new BufferAttribute(data.positions, 3));
    if (data.index) geometry.setIndex(new BufferAttribute(data.index, 1));
    geometry.setDrawRange(data.drawRange.start, data.drawRange.count);
    geometry.groups = data.groups;
    const tree = MeshBVH.serialize(new MeshBVH(geometry, { indirect: true }));
    const transfer = [...tree.roots];
    if (tree.index) transfer.push(tree.index.buffer as ArrayBuffer);
    if (tree.indirectBuffer)
      transfer.push(tree.indirectBuffer.buffer as ArrayBuffer);
    self.postMessage({ tree }, { transfer });
  } catch {
    self.postMessage({ failed: true });
  } finally {
    geometry.dispose();
  }
};
