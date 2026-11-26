// Absolute POSIX paths only. Every path in the state is normalised: "/", "/var", "/var/log".

export function normalize(p: string): string {
  const out: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return '/' + out.join('/');
}

/** Resolve what the player typed against cwd and home ("~", "~/x", "../x", "/x"). */
export function resolve(cwd: string, home: string, p: string): string {
  if (p === '~') return normalize(home);
  if (p.startsWith('~/')) return normalize(home + '/' + p.slice(2));
  if (p.startsWith('/')) return normalize(p);
  return normalize(cwd + '/' + p);
}

export function dirname(p: string): string {
  if (p === '/') return '/';
  const i = p.lastIndexOf('/');
  return i <= 0 ? '/' : p.slice(0, i);
}

export function basename(p: string): string {
  if (p === '/') return '/';
  return p.slice(p.lastIndexOf('/') + 1);
}

export function join(dir: string, name: string): string {
  return dir === '/' ? '/' + name : dir + '/' + name;
}

/** True when p is root itself or lies below it. */
export function isUnder(p: string, root: string): boolean {
  return root === '/' || p === root || p.startsWith(root + '/');
}

/** p relative to root ("" for root itself). Assumes isUnder(p, root). */
export function relativeTo(p: string, root: string): string {
  if (p === root) return '';
  return root === '/' ? p.slice(1) : p.slice(root.length + 1);
}
