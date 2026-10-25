/** Native ordered boundary walks start at the insertion-balanced tree root.
 * Shared by repair and reconstruction; keep insertion and erase order intact.
 */
export interface NativeBoundaryRecord {
  start: number;
  end: number;
}
interface BoundaryNode<T extends NativeBoundaryRecord> {
  black: boolean;
  left: BoundaryNode<T>;
  right: BoundaryNode<T>;
  parent: BoundaryNode<T>;
  record?: T;
}
export class NativeBoundaryTree<T extends NativeBoundaryRecord> {
  private readonly nil: BoundaryNode<T>;
  private root: BoundaryNode<T>;
  size: number;
  constructor() {
    this.nil = { black: true } as BoundaryNode<T>;
    this.nil.left = this.nil.right = this.nil.parent = this.nil;
    this.root = this.nil;
    this.size = 0;
  }
  _left(x: BoundaryNode<T>) {
    const y = x.right;
    x.right = y.left;
    if (y.left !== this.nil) y.left.parent = x;
    y.parent = x.parent;
    if (x.parent === this.nil) this.root = y;
    else if (x === x.parent.left) x.parent.left = y;
    else x.parent.right = y;
    y.left = x;
    x.parent = y;
  }
  _right(x: BoundaryNode<T>) {
    const y = x.left;
    x.left = y.right;
    if (y.right !== this.nil) y.right.parent = x;
    y.parent = x.parent;
    if (x.parent === this.nil) this.root = y;
    else if (x === x.parent.right) x.parent.right = y;
    else x.parent.left = y;
    y.right = x;
    x.parent = y;
  }
  insert(record: T) {
    const compare = (a: T, b: T) =>
      (a.start >>> 0) - (b.start >>> 0) || (a.end >>> 0) - (b.end >>> 0);
    let parent = this.nil,
      node = this.root,
      direction = 0;
    while (node !== this.nil) {
      parent = node;
      direction = compare(record, node.record!);
      if (!direction) return false;
      node = direction < 0 ? node.left : node.right;
    }
    let added: BoundaryNode<T> = {
      record,
      black: false,
      left: this.nil,
      right: this.nil,
      parent,
    };
    if (parent === this.nil) this.root = added;
    else if (direction < 0) parent.left = added;
    else parent.right = added;
    this.size++;
    while (!added.parent.black) {
      const p = added.parent,
        g = p.parent;
      if (p === g.left) {
        const uncle = g.right;
        if (!uncle.black) {
          p.black = uncle.black = true;
          g.black = false;
          added = g;
        } else {
          if (added === p.right) {
            added = p;
            this._left(added);
          }
          added.parent.black = true;
          added.parent.parent.black = false;
          this._right(added.parent.parent);
        }
      } else {
        const uncle = g.left;
        if (!uncle.black) {
          p.black = uncle.black = true;
          g.black = false;
          added = g;
        } else {
          if (added === p.left) {
            added = p;
            this._right(added);
          }
          added.parent.black = true;
          added.parent.parent.black = false;
          this._left(added.parent.parent);
        }
      }
    }
    this.root.black = true;
    return true;
  }
  _fixErase(node: BoundaryNode<T>) {
    while (node !== this.root && node.black) {
      const left = node === node.parent.left;
      let sibling = left ? node.parent.right : node.parent.left;
      if (!sibling.black) {
        sibling.black = true;
        node.parent.black = false;
        if (left) this._left(node.parent);
        else this._right(node.parent);
        sibling = left ? node.parent.right : node.parent.left;
      }
      let near = left ? sibling.left : sibling.right,
        far = left ? sibling.right : sibling.left;
      if (near.black && far.black) {
        sibling.black = false;
        node = node.parent;
      } else {
        if (far.black) {
          near.black = true;
          sibling.black = false;
          if (left) this._right(sibling);
          else this._left(sibling);
          sibling = left ? node.parent.right : node.parent.left;
        }
        sibling.black = node.parent.black;
        node.parent.black = true;
        far = left ? sibling.right : sibling.left;
        far.black = true;
        if (left) this._left(node.parent);
        else this._right(node.parent);
        node = this.root;
      }
    }
    node.black = true;
  }
  _erase(node: BoundaryNode<T>) {
    let removed = node;
    if (node.left !== this.nil && node.right !== this.nil) {
      removed = node.right;
      while (removed.left !== this.nil) removed = removed.left;
    }
    const replacement =
      removed.left !== this.nil ? removed.left : removed.right;
    replacement.parent = removed.parent;
    if (removed.parent === this.nil) this.root = replacement;
    else if (removed === removed.parent.left) removed.parent.left = replacement;
    else removed.parent.right = replacement;
    if (removed.black) this._fixErase(replacement);
    if (removed !== node) node.record = removed.record;
    this.size--;
  }
  takeNextWalk() {
    const records: T[] = [];
    if (!this.size) return records;
    let next = this.root.record!.start >>> 0;
    while (true) {
      let node = this.root;
      while (node !== this.nil && node.record!.start >>> 0 !== next)
        node = node.record!.start >>> 0 < next ? node.right : node.left;
      if (node === this.nil) break;
      const record = node.record!;
      next = record.end >>> 0;
      this._erase(node);
      if (next === 4294967295) break;
      records.push(record);
    }
    return records;
  }
}
