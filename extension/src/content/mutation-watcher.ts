/**
 * MutationObserver-based watcher for dynamically added content.
 * Incrementally extracts from new DOM nodes.
 */

import type { ExtractedImage, ExtractedVideo, ExtractedLink } from '../shared/types';
import { extractFromNodes } from './extractor';
import { debounce } from '../shared/messaging';

type MutationCallback = (result: {
  images: ExtractedImage[];
  videos: ExtractedVideo[];
  links: ExtractedLink[];
}) => void;

export class MutationWatcher {
  private observer: MutationObserver | null = null;
  private pendingNodes: Node[] = [];
  private callback: MutationCallback;
  private minWidth: number;
  private minHeight: number;

  private processPending = debounce(() => {
    if (this.pendingNodes.length === 0) return;
    const nodes = this.pendingNodes.splice(0);
    const nodeList = {
      length: nodes.length,
      item: (i: number) => nodes[i],
      forEach: (fn: (n: Node) => void) => nodes.forEach(fn),
      [Symbol.iterator]: nodes[Symbol.iterator].bind(nodes),
    } as unknown as NodeList;

    const result = extractFromNodes(nodeList, this.minWidth, this.minHeight);
    if (
      result.images.length > 0 ||
      result.videos.length > 0 ||
      result.links.length > 0
    ) {
      this.callback(result);
    }
  }, 400) as () => void;

  constructor(callback: MutationCallback, minWidth = 50, minHeight = 50) {
    this.callback = callback;
    this.minWidth = minWidth;
    this.minHeight = minHeight;
  }

  start(): void {
    if (this.observer) return;

    this.observer = new MutationObserver(mutations => {
      for (const mutation of mutations) {
        mutation.addedNodes.forEach(node => {
          this.pendingNodes.push(node);
        });
      }
      this.processPending();
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  stop(): void {
    this.observer?.disconnect();
    this.observer = null;
    this.pendingNodes = [];
  }
}
