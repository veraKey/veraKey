/**
 * Chrome's page translation, and some extensions, replace text nodes React rendered with nodes of their own.
 * React still holds the originals, so inserting before one, or removing one, throws NotFoundError and the whole
 * app falls into the error boundary (facebook/react#11538). Pages keep text that sits beside an element that
 * changes in an element of its own (translation.test.ts); this catches what they miss. The new node goes last
 * instead of before the missing one, and a node that is already gone stays gone.
 */
export function tolerateTranslation() {
  const { insertBefore, removeChild } = Node.prototype;
  Node.prototype.insertBefore = function <T extends Node>(this: Node, node: T, child: Node | null): T {
    if (child && child.parentNode !== this) {
      console.warn("Page translation moved a node React placed another before; placing it last", child);
      return insertBefore.call(this, node, null) as T;
    }
    return insertBefore.call(this, node, child) as T;
  };
  Node.prototype.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      console.warn("Page translation already removed a node React removes", child);
      return child;
    }
    return removeChild.call(this, child) as T;
  };
}
