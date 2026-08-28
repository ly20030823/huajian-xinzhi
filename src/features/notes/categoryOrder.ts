export type CategoryDropPosition = "before" | "after";

export function normalizeCategoryOrder(order: string[], categories: string[]): string[] {
  const available = new Set(categories);
  const normalized = order.filter((category, index) => {
    return available.has(category) && order.indexOf(category) === index;
  });

  for (const category of categories) {
    if (!normalized.includes(category)) normalized.push(category);
  }
  return normalized;
}

export function moveCategoryInOrder(
  order: string[],
  categories: string[],
  draggedCategory: string,
  targetCategory: string,
  position: CategoryDropPosition,
): string[] {
  const normalized = normalizeCategoryOrder(order, categories);
  if (draggedCategory === targetCategory || !normalized.includes(draggedCategory)) {
    return normalized;
  }

  const withoutDragged = normalized.filter((category) => category !== draggedCategory);
  const targetIndex = withoutDragged.indexOf(targetCategory);
  if (targetIndex < 0) return normalized;
  const insertIndex = position === "after" ? targetIndex + 1 : targetIndex;
  withoutDragged.splice(insertIndex, 0, draggedCategory);
  return withoutDragged;
}
