// ShivTallyCheck: the read-only report tool (plan 09 section 5). One run, no install, no service, and
// no write path of any kind: it uses the same fixed read list as the bridge, which holds only Exports.
// It says something useful even with Tally closed. The report holds no party name, amount or phone,
// and goes nowhere: it is one HTML page in Documents. Reports never go in the public repository.
import { mkdir, readFile, stat, statfs, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileVersion } from './pe-version.mjs';
import { runCommand } from './platform.mjs';
import { TallyClient, TallyError } from './tally-client.mjs';
import { buildCompanyList, buildRead } from './templates.mjs';
import { AGENT_VERSION } from './version.mjs';

const REQUEST_LIMIT_MS = 30000;
const BASE_TYPES = [
  'Sales',
  'Purchase',
  'Receipt',
  'Payment',
  'Credit Note',
  'Debit Note',
  'Journal',
];
const PORTS = [9000, 9001, 9002, 9003, 9004, 9005, 9006, 9007, 9008, 9009, 9010];
const HOW_TO_ENABLE = {
  prime:
    'TallyPrime: F1 > Settings > Connectivity > Client/Server Configuration. Set "TallyPrime acts as" to Both, port 9000.',
  erp9: 'Tally.ERP 9: F12 > Advanced Configuration. Set "Tally.ERP 9 is acting as" to Both, port 9000, then restart Tally.',
};

/** Reads flat <Fnn> answers, in either encoding. Enough for counts: this tool keeps no text from them. */
export function flatRows(buffer) {
  const text =
    buffer[1] === 0 || (buffer[0] === 0xff && buffer[1] === 0xfe)
      ? buffer.toString('utf16le')
      : buffer.toString('utf8');
  if (/<!(DOCTYPE|ENTITY)/i.test(text)) return [];
  const rows = [];
  let row = null;
  for (const match of text.matchAll(/<F(\d{2,3})>([^<]*)<\/F\d{2,3}>|<F(\d{2,3})\s*\/>/g)) {
    const index = Number(match[1] ?? match[3]);
    if (index === 1) {
      row = [];
      rows.push(row);
    }
    if (row)
      row[index - 1] = (match[2] ?? '')
        .replace(/&#\d+;/g, '')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .trim();
  }
  return rows;
}
const isYes = (text) => /^(yes|true|1)$/i.test(text ?? '');

export function makeProbes({ run = runCommand, paths = {} } = {}) {
  return {
    async pc(apiBase, fetchImpl = fetch) {
      const free = await statfs(paths.documents ?? os.homedir())
        .then((info) => Math.floor((info.bavail * info.bsize) / 1024 ** 3))
        .catch(() => null);
      const antivirus = await run('wmic', [
        '/namespace:\\\\root\\SecurityCenter2',
        'path',
        'AntiVirusProduct',
        'get',
        'displayName',
        '/value',
      ]);
      const power = await run('powercfg', ['/query', 'SCHEME_CURRENT', 'SUB_SLEEP', 'STANDBYIDLE']);
      let clockSeconds = null;
      let tls = 'not tried';
      if (apiBase) {
        try {
          const started = Date.now();
          const res = await fetchImpl(`${apiBase}/api/v1/bridge/time`, { redirect: 'error' });
          const { serverNow } = await res.json();
          clockSeconds = Math.round((Date.now() - Date.parse(serverNow)) / 1000);
          tls = started && res.ok ? 'ok' : `answered ${res.status}`;
        } catch {
          tls = 'failed';
        }
      }
      const sleepMatch = power && /Current AC Power Setting Index:\s*0x([0-9a-f]+)/i.exec(power);
      return {
        windows: os.version(),
        arch: os.arch(),
        ramGb: Math.round(os.totalmem() / 1024 ** 3),
        freeDiskGb: free,
        antivirus: antivirus
          ? [...antivirus.matchAll(/displayName=(.+)/gi)]
              .map((match) => match[1].trim())
              .join(', ') || 'none reported'
          : 'could not read',
        sleepAfterMinutes: sleepMatch ? Math.round(parseInt(sleepMatch[1], 16) / 60) : null,
        clockSeconds,
        tls,
      };
    },
    /** Finds the program without asking Tally. Never opens a company's data files, never edits a thing. */
    async tallyFile() {
      const listed = await run('tasklist', ['/FI', 'IMAGENAME eq tally.exe', '/NH']);
      const running = Boolean(listed && /tally\.exe/i.test(listed));
      // Where the running one came from, if Windows will say. Older PCs have wmic; newer may not.
      const where = running
        ? await run('wmic', [
            'process',
            'where',
            "name='tally.exe'",
            'get',
            'ExecutablePath',
            '/value',
          ])
        : null;
      const runningFrom = where && /ExecutablePath=(.+)\\tally\.exe/i.exec(where)?.[1]?.trim();
      const roots = paths.tallyFolders ?? [
        ...(runningFrom ? [runningFrom] : []),
        'C:\\Program Files\\TallyPrime',
        'C:\\Program Files\\Tally.ERP9',
        'C:\\Program Files (x86)\\Tally.ERP9',
        'C:\\Tally.ERP9',
        'C:\\TallyPrime',
      ];
      for (const folder of roots) {
        const exe = join(folder, 'tally.exe');
        try {
          await stat(exe);
        } catch {
          continue;
        }
        const version = await fileVersion(exe);
        let iniPort = null;
        let dataPathSet = false;
        try {
          const ini = await readFile(join(folder, 'tally.ini'), 'latin1');
          const port = /^\s*(?:ServerPort|Server\s*Port)\s*=\s*(\d+)/im.exec(ini);
          iniPort = port ? Number(port[1]) : null;
          dataPathSet = /^\s*Data\s*=/im.test(ini);
        } catch {
          // No ini beside the program: the port is tried anyway.
        }
        return { running, found: true, folder, version, iniPort, dataPathSet };
      }
      return {
        running,
        found: false,
        folder: null,
        version: null,
        iniPort: null,
        dataPathSet: false,
      };
    },
    lanAddresses() {
      return Object.values(os.networkInterfaces())
        .flat()
        .filter((entry) => entry && !entry.internal && entry.family === 'IPv4')
        .map((entry) => entry.address);
    },
  };
}

function connects(host, port, timeoutMs = 1500) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const done = (open) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

export function productName({ bare, release, major, exeVersion }) {
  const text = `${bare ?? ''} ${release ?? ''}`;
  // What ProdReleaseAsStr really holds is unverified, so the product's own name is taken back out.
  const number = (release ?? '').replace(/tally\s*prime|tally\.?\s*erp\s*9/gi, '').trim();
  if (/prime/i.test(text))
    return { family: 'prime', label: `TallyPrime ${number || major || ''}`.trim() };
  if (/erp\s*9/i.test(text)) return { family: 'erp9', label: `Tally.ERP 9 ${number}`.trim() };
  if (release) return { family: 'unknown', label: `Tally ${release}` };
  if (exeVersion) return { family: 'unknown', label: `Tally, file version ${exeVersion}` };
  return { family: 'unknown', label: 'Tally (see the photo of F1 > About)' };
}

/** Runs the stages in order. Each says what it found; a stage that cannot run says why and stops there. */
export async function runCheck({
  apiBase = null,
  probes = makeProbes(),
  clientFor = (port) =>
    new TallyClient({ port, requestMs: REQUEST_LIMIT_MS, idleMs: REQUEST_LIMIT_MS }),
  ports = PORTS,
  months = 13,
  today = new Date(),
  fetchImpl = fetch,
  pauseMs = 200,
} = {}) {
  const report = {
    at: today.toISOString(),
    tool: AGENT_VERSION,
    pc: await probes.pc(apiBase, fetchImpl),
    tallyFile: await probes.tallyFile(),
    port: null,
    product: null,
    licence: null,
    companies: [],
    listedOnly: 0,
    shape: [],
    exposure: null,
    proof: null,
    stoppedEarly: null,
    requests: 0,
  };
  // Stage 3: the port. It tries the configured one, then the usual range.
  const candidates = [...new Set([report.tallyFile.iniPort, ...ports].filter(Boolean))];
  let client = null;
  for (const port of candidates) {
    const tryClient = clientFor(port);
    const seen = await tryClient.bare();
    if (seen.open) {
      client = tryClient;
      report.port = {
        open: port,
        bare: seen.text
          .replace(/<[^>]*>/g, ' ')
          .trim()
          .slice(0, 120),
      };
      break;
    }
  }
  if (!client) {
    report.port = { open: null, tried: candidates, howTo: HOW_TO_ENABLE };
    report.product = productName({ exeVersion: report.tallyFile.version });
    return finish(report);
  }
  const ask = async (name, params, options) => {
    report.requests++;
    await new Promise((resolve) => setTimeout(resolve, pauseMs));
    const started = Date.now();
    const { body } = await client.small(buildRead(name, params, options), 64 * 1024 * 1024);
    const took = Date.now() - started;
    if (took > REQUEST_LIMIT_MS) throw new TallyError('BUSY');
    return { rows: flatRows(body), took };
  };
  const stageGuard = async (stage, work) => {
    try {
      return await work();
    } catch (error) {
      if (!(error instanceof TallyError)) throw error;
      report.stoppedEarly = { stage, why: error.code };
      return null;
    }
  };
  // Stage 4: identity.
  const before = await stageGuard('identity', async () => {
    const companies = await ask('companies');
    const licence = await ask('licence');
    return { companies: companies.rows, licence: licence.rows[0] ?? null };
  });
  if (!before) {
    report.product = productName({ bare: report.port.bare, exeVersion: report.tallyFile.version });
    return finish(report);
  }
  const licence = before.licence;
  report.licence = licence && {
    release: licence[2] ?? '',
    educational: isYes(licence[3]),
    licensed: isYes(licence[4]),
    silver: isYes(licence[5]),
    gold: isYes(licence[6]),
    editLog: isYes(licence[7]),
  };
  report.product = productName({
    bare: report.port.bare,
    release: licence?.[2],
    major: licence?.[0],
    exeVersion: report.tallyFile.version,
  });
  report.companies = before.companies.map((row) => ({
    name: row[1] ?? '',
    booksFrom: row[2] ?? '',
    lastVoucherDate: row[3] ?? '',
  }));
  if (!report.companies.length) {
    await stageGuard('list', async () => {
      report.requests++;
      const { body } = await client.small(buildCompanyList());
      const text = body[1] === 0 ? body.toString('utf16le') : body.toString('utf8');
      report.listedOnly = [...text.matchAll(/<COMPANY\s+NAME="/g)].length;
    });
  }
  // Stage 5: the shape of each company, counts only.
  const iso = (date) => date.toISOString().slice(0, 10);
  const monthStarts = Array.from({ length: months }, (_, index) => {
    const at = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - index, 1));
    const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 0));
    return {
      month: iso(at).slice(0, 7),
      from: iso(at).replaceAll('-', ''),
      to: iso(end).replaceAll('-', ''),
    };
  });
  for (const row of before.companies) {
    const company = row[1];
    const shape = { company };
    const done = await stageGuard('shape', async () => {
      const base = { company };
      const countOf = async (name, params = base) =>
        Number((await ask(name, params, { count: true })).rows[0]?.[0] ?? 0);
      shape.groups = await countOf('groups');
      const debtors = (await ask('parties', { ...base, group: 'Sundry Debtors' })).rows;
      const creditors = (await ask('parties', { ...base, group: 'Sundry Creditors' })).rows;
      shape.debtors = debtors.length;
      shape.creditors = creditors.length;
      // Only whether these are filled. The values themselves are dropped here, one line after reading.
      const share = (rows, test) =>
        rows.length ? Math.round((rows.filter(test).length / rows.length) * 100) : 0;
      shape.mobilePercent = share(debtors, (party) => Boolean(party[5] || party[6]));
      shape.billWisePercent = share(debtors, (party) => isYes(party[8]));
      shape.stockItems = await countOf('stockItems');
      shape.godowns = await countOf('godowns');
      const types = (await ask('voucherTypes', base)).rows;
      const parent = new Map(types.map((type) => [type[1], type[2]]));
      const baseOf = (name) => {
        const seen = new Set();
        let at = name;
        while (at && !seen.has(at)) {
          if (BASE_TYPES.includes(at)) return at;
          seen.add(at);
          at = parent.get(at);
        }
        return '';
      };
      shape.voucherTypes = types.length;
      shape.customTypes = types
        .map((type) => type[1])
        .filter((name) => baseOf(name) && !BASE_TYPES.includes(name));
      const byBase = Object.fromEntries(BASE_TYPES.map((name) => [name, []]));
      for (const type of types) {
        const name = baseOf(type[1]);
        // A quote mark cannot go into the filter, and such a type is left out of the counts.
        if (name && !type[1].includes('"')) byBase[name].push(type[1]);
      }
      shape.months = [];
      let slowest = 0;
      let asked = 0;
      let spent = 0;
      for (const month of monthStarts) {
        const counts = {};
        for (const name of BASE_TYPES) {
          if (!byBase[name].length) continue;
          const answer = await ask(
            'vouchers',
            { ...base, dayFrom: month.from, dayTo: month.to, types: byBase[name] },
            { count: true },
          );
          counts[name] = Number(answer.rows[0]?.[0] ?? 0);
          asked++;
          spent += answer.took;
          slowest = Math.max(slowest, answer.took);
        }
        shape.months.push({ month: month.month, counts });
      }
      shape.vouchersThisYear = shape.months
        .slice(0, 12)
        .reduce(
          (total, month) => total + Object.values(month.counts).reduce((a, b) => a + b, 0),
          0,
        );
      shape.secondsPerRequest = asked ? Math.round((spent / asked / 1000) * 100) / 100 : null;
      shape.slowestSeconds = Math.round((slowest / 1000) * 100) / 100;
      // Whether sales carry stock lines: one recent month, only whether any row came back.
      const sales = byBase.Sales;
      if (sales.length) {
        const answer = await ask('voucherStock', {
          ...base,
          dayFrom: monthStarts[0].from,
          dayTo: monthStarts[0].to,
          types: sales,
        });
        shape.carriesStockLines = answer.rows.length > 0;
      }
      return true;
    });
    report.shape.push(shape);
    if (!done) break;
  }
  // Stage 6: could another PC reach this port?
  const reachable = [];
  for (const address of probes.lanAddresses())
    if (await connects(address, report.port.open)) reachable.push(address);
  report.exposure = { lanAddresses: reachable.length, openToLan: reachable.length > 0 };
  // Stage 7: proof that nothing here moved Tally's own change marks.
  await stageGuard('proof', async () => {
    const after = await ask('companies');
    const keyed = (rows) => JSON.stringify(rows.map((row) => [row[0], row[4], row[5]]));
    const moved = keyed(before.companies) !== keyed(after.rows);
    report.proof = { moved };
  });
  return finish(report);
}

function finish(report) {
  const licensed = report.licence?.licensed && !report.licence?.educational;
  const edition = report.licence?.gold ? 'Gold' : report.licence?.silver ? 'Silver' : '';
  const bits = [`${report.product?.label ?? 'Tally'}${edition ? ` ${edition}` : ''}`];
  if (report.licence)
    bits.push(
      report.licence.educational ? 'educational mode' : licensed ? 'licensed' : 'licence unclear',
    );
  if (report.port?.open) {
    bits.push(
      `${report.companies.length} ${report.companies.length === 1 ? 'company' : 'companies'} open`,
    );
    const year = report.shape.reduce((total, shape) => total + (shape.vouchersThisYear ?? 0), 0);
    if (report.shape.length) bits.push(`about ${year.toLocaleString('en-IN')} vouchers this year`);
  }
  const blockers = [];
  if (report.pc.arch !== 'x64' && report.pc.arch !== 'arm64') blockers.push('32-bit Windows');
  if (report.pc.ramGb < 4) blockers.push('under 4 GB memory');
  if (!report.port?.open) blockers.push('the Tally port is off or Tally is closed');
  else if (!report.companies.length) blockers.push('no company is open');
  if (report.licence?.educational) blockers.push('Tally is in educational mode');
  report.canRun = blockers.length === 0;
  report.sentence = `${bits.join(', ')}${report.canRun ? ', bridge can run.' : `. Bridge cannot run yet: ${blockers.join('; ')}.`}`;
  report.howToEnable = report.port?.open ? null : HOW_TO_ENABLE;
  return report;
}

const esc = (value) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** One page, in English and Hinglish, 16 px body, the shop's own colours. Company names and counts. */
export function renderReport(report) {
  const row = (label, value) => `<tr><th>${esc(label)}</th><td>${esc(value)}</td></tr>`;
  const pc = report.pc;
  const shapes = report.shape
    .map(
      (shape) => `<h2>${esc(shape.company)}</h2><table>
${row('Groups', shape.groups)}
${row('Debtors / Grahak', shape.debtors)}
${row('Creditors / Supplier', shape.creditors)}
${row('Debtors with a mobile filled', `${shape.mobilePercent ?? '-'}%`)}
${row('Debtors bill-wise', `${shape.billWisePercent ?? '-'}%`)}
${row('Stock items', shape.stockItems)}
${row('Godowns', shape.godowns)}
${row('Voucher types', shape.voucherTypes)}
${row('Custom voucher types', (shape.customTypes ?? []).join(', ') || 'none')}
${row('Sales carry stock lines', shape.carriesStockLines === undefined ? '-' : shape.carriesStockLines ? 'yes' : 'no')}
${row('Seconds per request', shape.secondsPerRequest ?? '-')}
</table>${
        shape.months?.length
          ? `<table><tr><th>Month</th>${BASE_TYPES.map((name) => `<th>${esc(name)}</th>`).join('')}</tr>${shape.months
              .map(
                (month) =>
                  `<tr><td>${esc(month.month)}</td>${BASE_TYPES.map((name) => `<td>${esc(month.counts[name] ?? 0)}</td>`).join('')}</tr>`,
              )
              .join('')}</table>`
          : ''
      }`,
    )
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tally check</title>
<style>
body{background:#F6F4EE;color:#1F2322;font:16px/1.5 system-ui,sans-serif;margin:24px auto;max-width:880px;padding:0 16px}
h1{font-size:22px;margin:0 0 8px}h2{font-size:18px;margin:24px 0 8px}
.top{background:#FFF;border-left:4px solid #E0A42B;padding:12px 16px}
table{border-collapse:collapse;margin:8px 0;width:100%}th,td{border-bottom:1px solid #E3DFD4;padding:4px 8px;text-align:left}
td{font-variant-numeric:tabular-nums}.warn{color:#7A4E00}
</style></head><body>
<h1>Tally check / Tally ki jaanch</h1>
<p class="top">${esc(report.sentence)}</p>
<h2>This PC / Ye computer</h2><table>
${row('Windows', `${pc.windows} (${pc.arch})`)}
${row('Memory', `${pc.ramGb} GB`)}
${row('Free disk', pc.freeDiskGb === null ? '-' : `${pc.freeDiskGb} GB`)}
${row('Antivirus', pc.antivirus)}
${row('Sleeps after', pc.sleepAfterMinutes === null ? 'could not read' : `${pc.sleepAfterMinutes} min`)}
${row('Clock against our server', pc.clockSeconds === null ? '-' : `${pc.clockSeconds} s`)}
${row('Secure connection to our server', pc.tls)}
</table>
<h2>Tally</h2><table>
${row('Program', report.product?.label)}
${row('File version', report.tallyFile.version ?? '-')}
${row('Running now', report.tallyFile.running ? 'yes' : 'no')}
${row('Port', report.port?.open ?? `off (tried ${(report.port?.tried ?? []).join(', ')})`)}
${row('Open to other PCs', report.exposure ? (report.exposure.openToLan ? 'yes: the accountant decides on a firewall rule' : 'no') : '-')}
${row('Edit Log', report.licence ? (report.licence.editLog ? 'on' : 'off') : '-')}
${row('Companies open', report.companies.map((company) => company.name).join(', ') || 'none')}
${row('Change marks moved during this check', report.proof ? (report.proof.moved ? 'yes: the accountant was working' : 'no') : '-')}
</table>
${
  report.howToEnable
    ? `<h2>To turn the port on / Port chalu karne ke liye</h2><p>${esc(report.howToEnable.prime)}</p><p>${esc(report.howToEnable.erp9)}</p><p>This tool never changes the setting itself. Ye tool setting khud nahi badalta.</p>`
    : ''
}
${report.stoppedEarly ? `<p class="warn">Stopped early at ${esc(report.stoppedEarly.stage)}: ${esc(report.stoppedEarly.why)}. Tally was slow or stopped answering, so this tool stopped asking.</p>` : ''}
${shapes}
<p>Tool ${esc(report.tool)}, ${esc(report.at)}, ${esc(report.requests)} requests. No party name, amount or phone number is in this page. Keep it private.</p>
</body></html>`;
}

export async function main(argv = process.argv.slice(2), env = process.env, options = {}) {
  const api = argv[argv.indexOf('--api') + 1];
  const report = await runCheck({ apiBase: argv.includes('--api') ? api : null, ...options });
  const name = `ShivTallyCheck-${report.at.slice(0, 19).replace(/[:T]/g, '-')}.html`;
  const folder = join(env.USERPROFILE || os.homedir(), 'Documents');
  const path = join(folder, name);
  // Documents may be moved by OneDrive, and an ordinary folder here is fine for one page.
  await mkdir(folder, { recursive: true });
  await writeFile(path, renderReport(report));
  console.log(report.sentence);
  console.log(`Report: ${path}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1])
  process.exitCode = await main();
