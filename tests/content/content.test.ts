// The content validator: `npm run validate:content` runs this file, CI runs it on every push.

import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadContent } from '../../tools/content/load';
import { CONTENT_DIR, SCHEMA_DIR } from '../helpers';

describe('the content in this repository', () => {
  it('is valid', () => {
    const { errors } = loadContent(CONTENT_DIR, SCHEMA_DIR);
    expect(errors, errors.join('\n')).toEqual([]);
  });
});

describe('the validator rejects broken content', () => {
  let dir = '';
  const copy = () => {
    dir = mkdtempSync(join(tmpdir(), 'nines-content-'));
    cpSync(CONTENT_DIR, dir, { recursive: true });
    return dir;
  };
  const edit = (file: string, fn: (s: string) => string) => {
    const p = join(dir, file);
    writeFileSync(p, fn(readFileSync(p, 'utf8')));
  };
  const errorsAfter = (file: string, fn: (s: string) => string) => {
    copy();
    edit(file, fn);
    return loadContent(dir, SCHEMA_DIR).errors.join('\n');
  };
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it('schema: unknown fields and wrong types', () => {
    expect(errorsAfter('quests/disk-full/quest.yaml', (s) => s + 'script: "alert(1)"\n')).toMatch(/must NOT have additional properties/);
    expect(errorsAfter('quests/disk-full/quest.yaml', (s) => s.replace('money: 150', 'money: lots'))).toMatch(/money must be integer/);
  });
  it('a folder name must match the id', () => {
    expect(errorsAfter('quests/disk-full/quest.yaml', (s) => s.replace('id: disk-full', 'id: disk-empty'))).toMatch(/must equal the folder name/);
  });
  it('conditions must parse and type-check', () => {
    expect(errorsAfter('quests/disk-full/scenario.yaml', (s) => s.replace('disk_usage("/var") < 80', 'disk_usage("/var") < "80"'))).toMatch(/cannot compare/);
    expect(errorsAfter('quests/disk-full/scenario.yaml', (s) => s.replace('service("nginx") == "active"', 'service("ngnix") == "active"'))).toMatch(/no such service/);
    expect(errorsAfter('quests/disk-full/npc.yaml', (s) => s.replace('== "done"', '== "finished"'))).toMatch(/never a value/);
  });
  it('locale keys must exist in both languages with the same placeholders', () => {
    expect(errorsAfter('quests/disk-full/locales/nl.yaml', (s) => s.replace(/^title: .*$/m, ''))).toMatch(/missing key "title"/);
    expect(errorsAfter('quests/disk-full/quest.yaml', (s) => s.replace('summary: summary', 'summary: summery'))).toMatch(/unknown locale key "summery"/);
    expect(errorsAfter('locales/nl.yaml', (s) => s.replace('€{amount}', '€{bedrag}'))).toMatch(/placeholders/);
    expect(errorsAfter('quests/disk-full/locales/en.yaml', (s) => s + 'spare: "x"\n')).toMatch(/unused key "spare"/);
  });
  it('references must resolve', () => {
    expect(errorsAfter('quests/disk-full/quest.yaml', (s) => s.replace('roadmap_node: linux-disk', 'roadmap_node: linux-nope'))).toMatch(/unknown roadmap_node/);
    expect(errorsAfter('quests/disk-full/quest.yaml', (s) => s.replace('requires: []', 'requires: [nope]'))).toMatch(/requires unknown quest/);
    expect(errorsAfter('quests/disk-full/npc.yaml', (s) => s.replace('slot: npc-1', 'slot: npc-2'))).toMatch(/spawn slot junior-village\/npc-2 is taken twice/);
  });
  it('the content folder holds data only', () => {
    copy();
    writeFileSync(join(dir, 'quests', 'disk-full', 'hack.js'), 'fetch("https://example.com")');
    expect(loadContent(dir, SCHEMA_DIR).errors.join('\n')).toMatch(/unexpected file/);
  });
  it('names that would point at someone else\'s IP are refused', () => {
    expect(errorsAfter('quests/disk-full/locales/en.yaml', (s) => s.replace('Hi, I\'m Femke', 'Gotta catch them, like Pokémon'))).toMatch(/IP rule/);
  });
  it('keys that exist on Object.prototype are still unknown keys', () => {
    expect(errorsAfter('quests/disk-full/quest.yaml', (s) => s.replace('offer: [offer.1, offer.2]', 'offer: [offer.1, offer.2, constructor]'))).toMatch(/unknown locale key "constructor"/);
    expect(errorsAfter('shop.yaml', (s) => s.replace('description: item.raspberry_pi.desc', 'description: constructor'))).toMatch(/unknown locale key "constructor"/);
  });
  it('paths in conditions must be normalised', () => {
    expect(errorsAfter('quests/disk-full/scenario.yaml', (s) => s.replace('disk_usage("/var")', 'disk_usage("/var/")'))).toMatch(/normalised/);
  });
  it('names in conditions must exist and be quoted', () => {
    expect(errorsAfter('quests/disk-full/npc.yaml', (s) => s.replace('quest("disk-full")', 'quest("dsk-full")'))).toMatch(/no such quest/);
    expect(errorsAfter('quests/disk-full/npc.yaml', (s) => s.replace('quest("disk-full") == "done"', 'has_item("lambo")'))).toMatch(/no such shop item/);
    expect(errorsAfter('quests/disk-full/npc.yaml', (s) => s.replace('quest("disk-full") == "done"', 'xp("cooking") > 1'))).toMatch(/no such branch/);
    expect(errorsAfter('quests/disk-full/scenario.yaml', (s) => s.replace('!ran("df")', '!ran("htop")'))).toMatch(/not a command/);
    expect(errorsAfter('quests/disk-full/scenario.yaml', (s) => s.replace('!ran("df")', '!flag("nope")'))).toMatch(/no event in this scenario sets that flag/);
    expect(errorsAfter('quests/disk-full/scenario.yaml', (s) => s.replace('service("nginx") == "active"', 'service(pipeline_status) == "active"'))).toMatch(/needs a quoted name/);
  });
  it('requirements may not form a cycle', () => {
    copy();
    edit('quests/disk-full/quest.yaml', (s) => s.replace('requires: []', 'requires: [service-down]'));
    edit('quests/service-down/quest.yaml', (s) => s.replace('requires: []', 'requires: [disk-full]'));
    expect(loadContent(dir, SCHEMA_DIR).errors.join('\n')).toMatch(/quest requirements form a cycle/);
    expect(errorsAfter('roadmap.yaml', (s) => s.replace('title: node.linux.files, requires: []', 'title: node.linux.files, requires: [linux-services]'))).toMatch(/roadmap node requirements form a cycle/);
  });
  it('control characters, symlinks, stray images and maps (until the MVP) are refused', () => {
    expect(errorsAfter('quests/disk-full/locales/en.yaml', (s) => s.replace('title: "Disk full"', 'title: "Disk \\e]8;;https://x.test\\e\\\\full"'))).toMatch(/control characters/);
    copy();
    symlinkSync('/etc/passwd', join(dir, 'quests', 'disk-full', 'link.yaml'));
    writeFileSync(join(dir, 'quests', 'disk-full', 'stray.png'), Buffer.alloc(24));
    mkdirSync(join(dir, 'maps'));
    writeFileSync(join(dir, 'maps', 'junior-village.json'), 'not json');
    const errs = loadContent(dir, SCHEMA_DIR).errors.join('\n');
    expect(errs).toMatch(/symbolic links are not allowed/);
    expect(errs).toMatch(/no npc.yaml declares this image/);
    expect(errs).toMatch(/maps\/junior-village.json: unexpected file/);
  });
  it('the IP denylist covers every string and path, not just locale text', () => {
    expect(errorsAfter('quests/disk-full/scenario.yaml', (s) => s.replace('description: PostgreSQL RDBMS', 'description: Pokemon RDBMS'))).toMatch(/IP rule/);
  });
  it('machines must make sense', () => {
    expect(errorsAfter('quests/disk-full/scenario.yaml', (s) => s.replace('dirs: [/tmp, /var/tmp, /var/cache/nginx]', 'dirs: [/tmp, /var/tmp, /var/cache/nginx, /home/dev/NOTES.txt/inner]'))).toMatch(/lies below the file/);
  });
  it('sprites must be PNGs of the right size', () => {
    copy();
    edit('quests/disk-full/npc.yaml', (s) => s.replace('tint: "#c86848"', 'sprite: {file: femke.png, frame: 16, source: "test", license: CC0-1.0}'));
    writeFileSync(join(dir, 'quests', 'disk-full', 'femke.png'), 'not a png');
    expect(loadContent(dir, SCHEMA_DIR).errors.join('\n')).toMatch(/not a PNG/);
    const png = Buffer.alloc(24);
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
    png.writeUInt32BE(16, 16);
    png.writeUInt32BE(16, 20);
    writeFileSync(join(dir, 'quests', 'disk-full', 'femke.png'), png);
    expect(loadContent(dir, SCHEMA_DIR).errors.join('\n')).toMatch(/must be 48x64/);
  });
});
