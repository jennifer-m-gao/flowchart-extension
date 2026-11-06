export function createViewStack(initial) {
  const stack = [initial];
  return {
    current: () => stack[stack.length - 1],
    push: (view) => { stack.push(view); },
    pop: () => { if (stack.length > 1) stack.pop(); return stack[stack.length - 1]; },
    replace: (view) => { stack[stack.length - 1] = view; },
    depth: () => stack.length,
  };
}
