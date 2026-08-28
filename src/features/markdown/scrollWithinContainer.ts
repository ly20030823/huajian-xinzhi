export type ScrollBlockPosition = "start" | "center";

interface CenteredScrollTopInput {
  currentScrollTop: number;
  viewportHeight: number;
  scrollHeight: number;
  targetTop: number;
  targetHeight: number;
  block: ScrollBlockPosition;
}

export function calculateContainedScrollTop({
  currentScrollTop,
  viewportHeight,
  scrollHeight,
  targetTop,
  targetHeight,
  block,
}: CenteredScrollTopInput) {
  const offset = block === "center" ? (viewportHeight - targetHeight) / 2 : 0;
  const requestedTop = currentScrollTop + targetTop - offset;
  return Math.min(Math.max(0, requestedTop), Math.max(0, scrollHeight - viewportHeight));
}

export function findVerticalScrollContainer(element: HTMLElement, boundary?: HTMLElement | null) {
  let candidate = element.parentElement;

  while (candidate) {
    const style = window.getComputedStyle(candidate);
    const canScroll = /(auto|scroll|overlay)/.test(style.overflowY);
    if (canScroll && candidate.scrollHeight > candidate.clientHeight) return candidate;
    if (candidate === boundary) break;
    candidate = candidate.parentElement;
  }

  return boundary ?? null;
}

export function scrollElementWithinContainer(
  element: HTMLElement,
  container: HTMLElement,
  options: { block?: ScrollBlockPosition; behavior?: ScrollBehavior } = {},
) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const top = calculateContainedScrollTop({
    currentScrollTop: container.scrollTop,
    viewportHeight: container.clientHeight,
    scrollHeight: container.scrollHeight,
    targetTop: elementRect.top - containerRect.top,
    targetHeight: elementRect.height,
    block: options.block ?? "center",
  });

  container.scrollTo({ top, behavior: options.behavior ?? "smooth" });
}

export function restoreDocumentScrollOrigin() {
  document.documentElement.scrollTop = 0;
  document.documentElement.scrollLeft = 0;
  document.body.scrollTop = 0;
  document.body.scrollLeft = 0;
  if (window.scrollX !== 0 || window.scrollY !== 0) window.scrollTo(0, 0);
}
