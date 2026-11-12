/** DOM 轮询辅助:判断页面是否有用户正在进行的输入,轮询刷新应让路 */

/**
 * 页面繁忙条件(满足其一):
 * 1. 焦点在页面内的输入元素上(正在打字);
 * 2. 存在被用户改动且未保存的输入(元素带 data-dirty="1",由 main.ts 全局委托维护)。
 */
export function busyInput(scope: HTMLElement): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (el && scope.contains(el) && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) return true;
  return !!scope.querySelector('[data-dirty="1"]');
}
