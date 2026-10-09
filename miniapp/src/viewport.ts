/**
 * Сколько снизу закрывает софт-клавиатура — на столько поднимается док.
 *
 * Без поля ввода в фокусе это всегда 0: при резиновом отскоке iOS сдвигает
 * visualViewport.offsetTop в минус, и док раньше уезжал вверх вместе с отскоком.
 */
export function keyboardInset(innerHeight: number, vvHeight: number, vvOffsetTop: number, typing: boolean): number {
  if (!typing) return 0;
  return Math.max(0, innerHeight - vvHeight - Math.max(0, vvOffsetTop));
}
