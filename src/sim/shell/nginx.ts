// nginx's command line on machines that run nginx: -t tests the configuration the way nginx does
// (the file and line of the first error), -T tests and prints every file it read, -v and -V the
// version, -s reload|stop|quit|reopen signals the running master. Mark's playtest (27 Nov 2026):
// "when we troubleshoot nginx, I expect nginx CLI options". `systemctl restart nginx` runs the same
// test first, as systemd's ExecStartPre does, so a broken config fails with its own error.
//
// The parser is small and strict where nginx is: statements end with ";", blocks open with "{"
// and close with "}", "#" starts a comment, quotes group words, `include` reads files (globs
// relative to /etc/nginx), and an unknown directive is an error. The directive list is the common
// core and http modules; it is a list, not nginx, so a rare directive may be missing.

import { normalize } from '../path';
import type { SimState } from '../state';
import { expandGlob, hasGlob } from '../vfs';
import { clock, type Command, fail, ok } from './util';

const ROOT = '/etc/nginx/nginx.conf';
export const NGINX_VERSION = 'nginx/1.24.0';

const DIRECTIVES = new Set(
  `user worker_processes worker_connections worker_rlimit_nofile error_log pid include events http stream mail server
  location listen server_name root alias index try_files return rewrite autoindex autoindex_exact_size autoindex_format
  autoindex_localtime access_log log_format sendfile tcp_nopush tcp_nodelay keepalive_timeout keepalive_requests
  types default_type types_hash_max_size types_hash_bucket_size server_names_hash_bucket_size server_tokens
  client_max_body_size client_body_timeout client_header_timeout send_timeout gzip gzip_types gzip_vary gzip_proxied
  gzip_comp_level gzip_min_length gzip_disable proxy_pass proxy_set_header proxy_http_version proxy_read_timeout
  proxy_connect_timeout proxy_send_timeout proxy_buffering proxy_redirect proxy_cache proxy_cache_path proxy_hide_header
  fastcgi_pass fastcgi_param fastcgi_index upstream ssl_certificate ssl_certificate_key ssl_protocols ssl_ciphers
  ssl_prefer_server_ciphers ssl_session_cache ssl_session_timeout ssl_stapling add_header expires etag if set
  allow deny auth_basic auth_basic_user_file limit_req limit_req_zone limit_conn limit_conn_zone error_page internal
  charset resolver real_ip_header set_real_ip_from map geo split_clients multi_accept use daemon master_process
  worker_cpu_affinity load_module env open_file_cache satisfy sub_filter stub_status http2 ssl_dhparam
  large_client_header_buffers client_body_buffer_size limit_except break uwsgi_param uwsgi_pass
  uwsgi_read_timeout scgi_pass scgi_param grpc_pass index_file absolute_redirect port_in_redirect`.split(/\s+/),
);

export type NginxTest = { ok: true; files: string[]; lines: string[] } | { ok: false; files: string[]; lines: string[] };

interface Token {
  text: string;
  file: string;
  line: number;
}

class ConfError extends Error {}

function tokenize(text: string, file: string): Token[] {
  const out: Token[] = [];
  let line = 1;
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\n') {
      line++;
      i++;
    } else if (c === ' ' || c === '\t' || c === '\r') i++;
    else if (c === '#') while (i < text.length && text[i] !== '\n') i++;
    else if (c === '{' || c === '}' || c === ';') {
      out.push({ text: c, file, line });
      i++;
    } else if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      if (end < 0) throw new ConfError(`unexpected end of file, expecting ";" or "}" in ${file}:${line}`);
      const word = text.slice(i + 1, end);
      out.push({ text: word === '' ? '""' : word, file, line });
      line += (word.match(/\n/g) ?? []).length;
      i = end + 1;
    } else {
      let j = i;
      while (j < text.length && !/[\s{};#]/.test(text[j]!)) j++;
      out.push({ text: text.slice(i, j), file, line });
      i = j;
    }
  }
  return out;
}

/** Test the configuration as `nginx -t` does. */
export function nginxTest(s: SimState): NginxTest | null {
  if (s.fs[ROOT]?.type !== 'file') return s.fs[ROOT] === undefined ? null : { ok: false, files: [], lines: [`nginx: [emerg] open() "${ROOT}" failed (21: Is a directory)`, `nginx: configuration file ${ROOT} test failed`] };
  const files: string[] = [];
  const read = (path: string, from: Token | null): Token[] => {
    const n = s.fs[path];
    if (n?.type !== 'file') throw new ConfError(`open() "${path}" failed (2: No such file or directory)${from ? ` in ${from.file}:${from.line}` : ''}`);
    files.push(path);
    return tokenize(n.content ?? '', path);
  };
  try {
    let sawEvents = false;
    // inside types, map, geo and split_clients the lines are data, not directives
    const blocks: string[] = [];
    const dataBlock = () => ['types', 'map', 'geo', 'split_clients'].includes(blocks.at(-1) ?? '');
    /** One file's statements; an included file is parsed in place and must close its own blocks. */
    const parse = (tokens: Token[], file: string): void => {
      const depthAtStart = blocks.length;
      let stmt: Token[] = [];
      for (const t of tokens) {
        if (t.text === ';' || t.text === '{') {
          const head = stmt[0];
          if (!head) throw new ConfError(`unexpected "${t.text}" in ${t.file}:${t.line}`);
          if (dataBlock()) {
            if (t.text === '{') throw new ConfError(`unexpected "{" in ${t.file}:${t.line}`);
            stmt = [];
            continue;
          }
          if (!DIRECTIVES.has(head.text)) throw new ConfError(`unknown directive "${head.text}" in ${head.file}:${head.line}`);
          // a statement that runs over into the next line's directive lost its ";"
          const runOn = stmt.slice(1).find((x) => x.line > head.line && DIRECTIVES.has(x.text) && x.text !== head.text);
          if (runOn) throw new ConfError(`directive "${head.text}" is not terminated by ";" in ${head.file}:${head.line}`);
          if (t.text === '{') {
            blocks.push(head.text);
            if (head.text === 'events' && blocks.length === 1) sawEvents = true;
          } else if (head.text === 'include') {
            const arg = stmt[1];
            if (!arg) throw new ConfError(`invalid number of arguments in "include" directive in ${head.file}:${head.line}`);
            const pattern = normalize(arg.text.startsWith('/') ? arg.text : `/etc/nginx/${arg.text}`);
            const hits = hasGlob(pattern) ? expandGlob(s, pattern).filter((p) => s.fs[p]?.type === 'file') : [pattern];
            for (const p of hits) parse(read(p, head), p);
          } else if (stmt.length === 1 && !['break', 'internal', 'ssl_stapling', 'http2', 'multi_accept'].includes(head.text)) {
            throw new ConfError(`invalid number of arguments in "${head.text}" directive in ${head.file}:${head.line}`);
          }
          stmt = [];
        } else if (t.text === '}') {
          if (stmt.length > 0 && !dataBlock()) throw new ConfError(`directive "${stmt[0]!.text}" is not terminated by ";" in ${stmt[0]!.file}:${stmt[0]!.line}`);
          if (blocks.length <= depthAtStart) throw new ConfError(`unexpected "}" in ${t.file}:${t.line}`);
          blocks.pop();
          stmt = [];
        } else stmt.push(t);
      }
      const last = tokens.at(-1);
      const open = blocks.length > depthAtStart;
      if (stmt.length > 0 || open) throw new ConfError(`unexpected end of file, expecting "${open && stmt.length === 0 ? '}' : ';'}" in ${file}:${last?.line ?? 1}`);
    };
    parse(read(ROOT, null), ROOT);
    if (!sawEvents) throw new ConfError(`no "events" section in configuration`);
    return { ok: true, files, lines: [`nginx: the configuration file ${ROOT} syntax is ok`, `nginx: configuration file ${ROOT} test is successful`] };
  } catch (e) {
    if (!(e instanceof ConfError)) throw e;
    return { ok: false, files, lines: [`nginx: [emerg] ${e.message}`, `nginx: configuration file ${ROOT} test failed`] };
  }
}

export const nginx: Command = (ctx, args) => {
  const test = () => nginxTest(ctx.s) ?? { ok: false as const, files: [], lines: [`nginx: [emerg] open() "${ROOT}" failed (2: No such file or directory)`, `nginx: configuration file ${ROOT} test failed`] };
  const flag = args[0];
  if (flag === '-v') return ok([`nginx version: ${NGINX_VERSION}`]);
  if (flag === '-V') return ok([`nginx version: ${NGINX_VERSION}`, 'built with OpenSSL 3.0.13', 'TLS SNI support enabled', 'configure arguments: --prefix=/usr/share/nginx --conf-path=/etc/nginx/nginx.conf --with-http_ssl_module --with-http_v2_module']);
  if (flag === '-t' || flag === '-tq' || flag === '-T') {
    const r = test();
    if (!r.ok) return fail(r.lines);
    if (flag === '-tq') return ok();
    if (flag === '-t') return ok(r.lines);
    // -T: the test, then every file it read
    return ok([...r.lines, ...r.files.flatMap((f) => [`# configuration file ${f}:`, ...(ctx.s.fs[f]?.type === 'file' ? (ctx.s.fs[f] as { content?: string }).content ?? '' : '').replace(/\n$/, '').split('\n'), ''])], { pager: true });
  }
  if (flag === '-s') {
    const signal = args[1];
    if (!['reload', 'stop', 'quit', 'reopen'].includes(signal ?? '')) return fail([`nginx: invalid option: "-s ${signal ?? ''}"`]);
    const svc = ctx.s.services['nginx'];
    if (!svc || svc.state !== 'active') return fail(['nginx: [error] invalid PID number "" in "/run/nginx.pid"']);
    if (signal === 'reload') {
      const r = test();
      if (!r.ok) return fail(r.lines.slice(0, 1));
      svc.logs.push(`${clock(ctx.s)} ${ctx.s.host} nginx[${1200 + ctx.s.counters.commands}]: signal process started`);
    }
    if (signal === 'stop' || signal === 'quit') svc.state = 'inactive';
    return ok([`${clock(ctx.s).replace(/^Nov 26/, '2026/11/26')} [notice] ${1200 + ctx.s.counters.commands}#${1200 + ctx.s.counters.commands}: signal process started`]);
  }
  if (flag === undefined) return fail([ctx.t('sh.nginx_start')]);
  return fail([`nginx: invalid option: "${flag.replace(/^-/, '')}"`, ctx.t('sh.usage', { usage: 'nginx -t | -T | -v | -s reload|stop|quit|reopen' })]);
};
