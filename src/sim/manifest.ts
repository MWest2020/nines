// Just enough of a Kubernetes manifest for the simulator: which object it is (kind, namespace,
// name) and the value of a `key: value` line. Not a YAML parser: scenario manifests are small
// and flat, and the simulator only needs to know what `kubectl apply` would change.

export interface ManifestId {
  kind: string;
  name: string;
  /** from metadata.namespace; absent means the namespace kubectl was given (or default) */
  namespace?: string;
}

const unquote = (v: string): string => {
  const m = /^(["'])(.*)\1$/.exec(v);
  return m ? m[2]! : v;
};

/** kind, metadata.name and metadata.namespace, or null when kind or name is missing. */
export function manifestId(text: string): ManifestId | null {
  const lines = text.split('\n');
  const kind = lines.map((l) => /^kind:[ ]*([A-Za-z]+)[ ]*$/.exec(l)?.[1]).find((k) => k !== undefined);
  const meta = lines.findIndex((l) => /^metadata:[ ]*$/.test(l));
  let name: string | undefined;
  let namespace: string | undefined;
  if (meta >= 0) {
    const block: string[] = [];
    for (const l of lines.slice(meta + 1)) {
      if (l.trim() === '' || l.trimStart().startsWith('#')) continue;
      if (!/^[ ]/.test(l)) break;
      block.push(l);
    }
    const indent = block[0] ? /^[ ]*/.exec(block[0])![0].length : 0;
    for (const l of block) {
      if (/^[ ]*/.exec(l)![0].length !== indent) continue;
      const m = /^[ ]*(name|namespace):[ ]*(\S+)[ ]*$/.exec(l);
      if (m?.[1] === 'name') name = unquote(m[2]!);
      if (m?.[1] === 'namespace') namespace = unquote(m[2]!);
    }
  }
  if (!kind || !name || !/^[a-z0-9][a-z0-9.-]*$/.test(name)) return null;
  return namespace && /^[a-z0-9-]+$/.test(namespace) ? { kind, name, namespace } : { kind, name };
}

/** The cluster's key for an object: "configmap/shop/shop-api-config". */
export const objectKey = (id: ManifestId, defaultNamespace: string): string =>
  `${id.kind.toLowerCase()}/${id.namespace ?? defaultNamespace}/${id.name}`;

/** The resource name kubectl prints for a kind: "deployment.apps", "configmap". */
export function resourceName(kind: string): string {
  const k = kind.toLowerCase();
  const groups: Record<string, string> = {
    deployment: 'apps', statefulset: 'apps', daemonset: 'apps', replicaset: 'apps',
    job: 'batch', cronjob: 'batch',
    ingress: 'networking.k8s.io', networkpolicy: 'networking.k8s.io',
    role: 'rbac.authorization.k8s.io', rolebinding: 'rbac.authorization.k8s.io',
    clusterrole: 'rbac.authorization.k8s.io', clusterrolebinding: 'rbac.authorization.k8s.io',
  };
  return Object.hasOwn(groups, k) ? `${k}.${groups[k]}` : k;
}

/** The value of the first `key: value` line (quotes and a trailing comment removed), or ''. */
export function manifestValue(text: string, key: string): string {
  for (const l of text.split('\n')) {
    const m = /^[ ]*([A-Za-z0-9_.-]+):[ ]*(.*)$/.exec(l);
    if (!m || m[1] !== key) continue;
    const raw = m[2]!.trim();
    const q = /^(["'])(.*?)\1/.exec(raw);
    return q ? q[2]! : raw.replace(/[ ]+#.*$/, '').trim();
  }
  return '';
}

/** What apply compares: the text without comment lines, blank lines and trailing spaces. */
export const significant = (text: string): string =>
  text
    .split('\n')
    .map((l) => l.trimEnd())
    .filter((l) => l !== '' && !l.trimStart().startsWith('#'))
    .join('\n');
