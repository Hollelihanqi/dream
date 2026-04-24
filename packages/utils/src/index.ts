export function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

export function createPackageName(scope: string, name: string): string {
  invariant(scope.length > 0, 'scope is required');
  invariant(name.length > 0, 'name is required');

  return `@${scope}/${name}`;
}
