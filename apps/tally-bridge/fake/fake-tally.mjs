// A pretend Tally for tests, on 127.0.0.1. It answers the XML shapes of plan 09 section 7 from a small
// synthetic company, and can misbehave the ways community notes say the real one does. It is a guess
// at Tally built from documents, not a recording of it: nothing here has been checked against Tally.
import http from 'node:http';

const xml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const unxml = (text) =>
  text
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
/** Paise to Tally's plain number, with debit negative, as AMT() in plan 09 makes it. */
const amount = (paise, style = 'plain') => {
  const negative = paise < 0n;
  const abs = negative ? -paise : paise;
  const whole = String(abs / 100n);
  const text = `${whole}.${String(abs % 100n).padStart(2, '0')}`;
  if (style === 'indian') {
    const grouped =
      whole.length > 3
        ? `${whole.slice(0, -3).replace(/\B(?=(\d{2})+$)/g, ',')},${whole.slice(-3)}`
        : whole;
    return `${negative ? '(-)' : ''}${grouped}.${String(abs % 100n).padStart(2, '0')}`;
  }
  return `${negative ? '-' : ''}${text}`;
};
const dayNumber = (date) => date.replaceAll('-', '');
const yesNo = (value) => (value ? 'Yes' : 'No');
const months = 'Jan,Feb,Mar,Apr,May,Jun,Jul,Aug,Sep,Oct,Nov,Dec'.split(',');
const isoFrom = (text) => {
  const match = /^(\d{1,2})-([A-Z][a-z]{2})-(\d{4})$/.exec(text);
  return match
    ? `${match[3]}-${String(months.indexOf(match[2]) + 1).padStart(2, '0')}-${match[1].padStart(2, '0')}`
    : null;
};

/** A small company with everything the reads ask for. All of it is made up. */
export function makeCompany(overrides = {}) {
  return {
    guid: 'co-guid-0001',
    name: 'Bench Traders',
    booksFrom: '2025-04-01',
    altMstId: 10n,
    altVchId: 0n,
    groups: [{ guid: 'grp-1', alterId: 1n, name: 'Sundry Debtors', parent: 'Current Assets' }],
    ledgers: [],
    voucherTypes: [
      { guid: 'vt-1', name: 'Sales', parent: 'Sales' },
      { guid: 'vt-2', name: 'Purchase', parent: 'Purchase' },
      { guid: 'vt-3', name: 'Receipt', parent: 'Receipt' },
      { guid: 'vt-4', name: 'Payment', parent: 'Payment' },
      { guid: 'vt-5', name: 'Credit Note', parent: 'Credit Note' },
      { guid: 'vt-6', name: 'Debit Note', parent: 'Debit Note' },
      { guid: 'vt-7', name: 'Journal', parent: 'Journal' },
      { guid: 'vt-8', name: 'GST Sale', parent: 'Sales' },
      { guid: 'vt-9', name: 'Payroll', parent: 'Payroll' },
      { guid: 'vt-10', name: 'Contra', parent: 'Contra' },
    ],
    stockItems: [
      {
        guid: 'si-1',
        alterId: 1n,
        name: 'Test Cement PPC',
        parent: 'Cement',
        baseUnits: 'Bag',
        closingQty: '100 Bag',
        closingValue: 3500000n,
      },
    ],
    godowns: [{ guid: 'gd-1', name: 'Main Location', parent: '' }],
    vouchers: [],
    ...overrides,
  };
}
export function addLedger(company, ledger) {
  const row = {
    masterId: String(company.ledgers.length + 1),
    alterId: ++company.altMstId,
    parent: ledger.class === 'CREDITOR' ? 'Sundry Creditors' : 'Sundry Debtors',
    mobile: '',
    phone: '',
    gstin: '',
    billWise: true,
    opening: 0n,
    ...ledger,
  };
  company.ledgers.push(row);
  return row;
}
export function addVoucher(company, voucher) {
  const row = {
    masterId: String(company.vouchers.length + 1),
    alterId: ++company.altVchId,
    number: String(company.vouchers.length + 1),
    party: '',
    reference: '',
    narration: '',
    isOptional: false,
    isCancelled: false,
    items: [],
    ...voucher,
  };
  company.vouchers.push(row);
  return row;
}
/** A credit sale: the party's debit (negative), the sales account's credit. */
export function sale(company, { guid, date, party, paise, type = 'Sales', ...rest }) {
  return addVoucher(company, {
    guid,
    date,
    type,
    party,
    lines: [
      { ledger: party, amount: -paise },
      { ledger: 'Sales Account', amount: paise },
    ],
    items: [{ item: 'Test Cement PPC', qty: '10 Bag', rate: '350.00/Bag', amount: paise }],
    ...rest,
  });
}
export function receipt(company, { guid, date, party, paise, ...rest }) {
  return addVoucher(company, {
    guid,
    date,
    type: 'Receipt',
    party,
    lines: [
      { ledger: party, amount: paise },
      { ledger: 'Cash', amount: -paise },
    ],
    ...rest,
  });
}
export function alterVoucher(company, guid, changes) {
  const row = company.vouchers.find((voucher) => voucher.guid === guid);
  Object.assign(row, changes, { alterId: ++company.altVchId });
  return row;
}
export function removeVoucher(company, guid) {
  // A delete leaves no mark: neither the id nor Tally's own change mark says anything happened.
  company.vouchers = company.vouchers.filter((voucher) => voucher.guid !== guid);
}

const envelope = (body) => `<ENVELOPE>\n${body}\n</ENVELOPE>\n`;
const flat = (rows) =>
  rows
    .map((row) =>
      row
        .map(
          (cell, index) =>
            `<F${String(index + 1).padStart(2, '0')}>${xml(cell)}</F${String(index + 1).padStart(2, '0')}>`,
        )
        .join(''),
    )
    .join('\n');
const LINE_ERROR = (name) =>
  `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>0</STATUS></HEADER><BODY><DATA><LINEERROR>Could not set 'SVCurrentCompany' to '${xml(name)}'</LINEERROR></DATA></BODY></ENVELOPE>`;

export class FakeTally {
  /** quirks: see the switch in answer(). requests holds every request seen, decoded. */
  constructor({ companies = [makeCompany()], listed = null, product = {}, quirks = {} } = {}) {
    this.companies = companies;
    this.listed = listed;
    this.product = {
      major: '7',
      minor: '1',
      release: 'TallyPrime 7.1',
      educational: false,
      licensed: true,
      silver: true,
      gold: false,
      editLog: false,
      bare: '<RESPONSE>TallyPrime Server is Running</RESPONSE>',
      ...product,
    };
    this.quirks = quirks;
    this.requests = [];
    this.server = http.createServer((req, res) => this.handle(req, res));
    this.sockets = new Set();
    this.server.on('connection', (socket) => {
      this.sockets.add(socket);
      socket.on('close', () => this.sockets.delete(socket));
    });
  }
  async listen(port = 0) {
    await new Promise((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, '127.0.0.1', resolve);
    });
    this.port = this.server.address().port;
    return this.port;
  }
  async close() {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }
  handle(req, res) {
    if (req.method === 'GET') {
      res.end(this.product.bare);
      return;
    }
    const pieces = [];
    req.on('data', (piece) => pieces.push(piece));
    req.on('end', () => {
      const raw = Buffer.concat(pieces);
      const body = raw.toString('utf16le');
      const record = {
        body,
        contentType: req.headers['content-type'],
        utf16: /charset=utf-16/i.test(req.headers['content-type'] ?? ''),
      };
      this.requests.push(record);
      this.answer(record, res);
    });
  }
  send(res, text, { bom = false, encoding = 'utf16le' } = {}) {
    const bytes = Buffer.from(text, encoding);
    res.writeHead(200, {
      'Content-Type': `text/xml; charset=${encoding === 'utf16le' ? 'utf-16' : 'utf-8'}`,
    });
    res.end(bom ? Buffer.concat([Buffer.from([0xff, 0xfe]), bytes]) : bytes);
  }
  answer(record, res) {
    const quirks = this.quirks;
    const body = record.body;
    if (quirks.status500) {
      res.writeHead(500);
      res.end();
      return;
    }
    // A sleeping PC or a jammed Tally: the connection opens and nothing ever comes back.
    if (quirks.hang) return;
    if (quirks.garbled) {
      this.send(res, '<ENVELOPE><F01>half<F02>not closed</F01>&&&<<<');
      return;
    }
    if (quirks.dtd) {
      this.send(res, `<!DOCTYPE lolz [<!ENTITY lol "lol">]>${envelope('<F01>&lol;</F01>')}`);
      return;
    }
    if (quirks.huge) {
      res.writeHead(200);
      const line = Buffer.from(flat([['x'.repeat(200)]]), 'utf16le');
      let sent = 0;
      const pump = () => {
        while (sent < quirks.huge) {
          sent += line.length;
          if (!res.write(line)) {
            res.once('drain', pump);
            return;
          }
        }
        res.end();
      };
      res.socket.on('close', () => (sent = Infinity));
      pump();
      return;
    }
    if (!/<TALLYREQUEST>Export<\/TALLYREQUEST>/.test(body)) {
      this.writeAttempts = (this.writeAttempts ?? 0) + 1;
      this.send(res, '<RESPONSE><CREATED>1</CREATED></RESPONSE>');
      return;
    }
    if (/<ID>List of Companies<\/ID>/.test(body)) {
      const names = this.listed ?? this.companies.map((company) => company.name);
      this.send(
        res,
        `<ENVELOPE><HEADER><VERSION>1</VERSION><STATUS>1</STATUS></HEADER><BODY><DATA><COLLECTION>${names.map((name) => `<COMPANY NAME="${xml(name)}"><NAME>${xml(name)}</NAME></COMPANY>`).join('')}</COLLECTION></DATA></BODY></ENVELOPE>`,
      );
      return;
    }
    const text = this.render(body, quirks);
    const cut =
      quirks.cutOff &&
      !quirks.cutOffProbes &&
      /\$Guid/.test(body) &&
      !/<TYPE>Company<\/TYPE>/.test(body);
    const short = cut ? text.slice(0, Math.floor(text.length / 2)) : text;
    this.send(res, short, { bom: Boolean(quirks.bom), encoding: quirks.utf8 ? 'utf8' : 'utf16le' });
  }
  render(body, quirks) {
    const isCount = body.includes('$$NumItems:ShivC');
    const collection = /<COLLECTION NAME="ShivC">(.*?)<\/COLLECTION>/s.exec(body)?.[1] ?? '';
    const type = /<TYPE>(\w+)<\/TYPE>/.exec(collection)?.[1];
    if (type === 'Company') {
      if (body.includes('$$ProdInfo')) {
        const p = this.product;
        if (!this.companies.length) return envelope('');
        return envelope(
          flat([
            [
              p.major,
              p.minor,
              p.release,
              yesNo(p.educational),
              yesNo(p.licensed),
              yesNo(p.silver),
              yesNo(p.gold),
              yesNo(p.editLog),
            ],
          ]),
        );
      }
      if (quirks.emptyCompanies) return envelope('');
      return envelope(
        flat(
          this.companies.map((company) => [
            company.guid,
            company.name,
            company.booksFrom,
            company.vouchers.reduce(
              (max, voucher) => (voucher.date > max ? voucher.date : max),
              '',
            ),
            String(company.altMstId),
            String(company.altVchId),
          ]),
        ),
      );
    }
    const named = /<SVCURRENTCOMPANY>(.*?)<\/SVCURRENTCOMPANY>/.exec(body);
    const company = this.companies.find((row) => row.name === unxml(named?.[1] ?? ''));
    if (!company) return LINE_ERROR(unxml(named?.[1] ?? ''));
    const toDate =
      isoFrom(/<SVTODATE TYPE="Date">(.*?)<\/SVTODATE>/.exec(body)?.[1] ?? '') ?? '9999-12-31';
    const rows = this.rows(type, company, collection, body, toDate, quirks);
    if (isCount) return envelope(flat([[String(rows.count ?? rows.length)]]));
    const list =
      quirks.shortBy && rows.length > quirks.shortBy ? rows.slice(0, -quirks.shortBy) : rows;
    return envelope(flat(list));
  }
  rows(type, company, collection, body, toDate, quirks) {
    switch (type) {
      case 'Group':
        return company.groups.map((row) => [row.guid, String(row.alterId), row.name, row.parent]);
      case 'VoucherType':
        return company.voucherTypes.map((row) => [row.guid, row.name, row.parent]);
      case 'Godown':
        return company.godowns.map((row) => [row.guid, row.name, row.parent]);
      case 'StockItem':
        return company.stockItems.map((row) => [
          row.guid,
          String(row.alterId),
          row.name,
          row.parent,
          row.baseUnits,
          row.closingQty,
          amount(row.closingValue),
        ]);
      case 'Ledger': {
        const group = /<CHILDOF>(.*?)<\/CHILDOF>/.exec(collection)?.[1];
        const wanted = group === 'Sundry Creditors' ? 'CREDITOR' : 'DEBTOR';
        return company.ledgers
          .filter((row) => (row.class ?? 'DEBTOR') === wanted)
          .map((row) => {
            const moved = company.vouchers
              .filter(
                (voucher) => voucher.date <= toDate && !voucher.isOptional && !voucher.isCancelled,
              )
              .flatMap((voucher) => voucher.lines)
              .filter((line) => line.ledger === row.name)
              .reduce((sum, line) => sum + line.amount, 0n);
            const style = quirks.indianAmounts ? 'indian' : 'plain';
            return [
              row.guid,
              row.masterId,
              String(row.alterId),
              row.name,
              row.parent,
              row.mobile,
              row.phone,
              row.gstin,
              yesNo(row.billWise),
              amount(row.opening, style),
              amount(row.opening + moved, style),
            ];
          });
      }
      case 'Voucher': {
        const delta = /\$AlterId &gt; (\d+) AND \$AlterId &lt;= (\d+)/.exec(body);
        const days = /&gt;= (\d{8}) AND .*?&lt;= (\d{8})/.exec(
          /NAME="ShivDay">(.*?)<\/SYSTEM>/s.exec(body)?.[1] ?? '',
        );
        const typeNames = [
          ...(/NAME="ShivTypes">(.*?)<\/SYSTEM>/s.exec(body)?.[1] ?? '').matchAll(
            /\$VoucherTypeName = "(.*?)"/g,
          ),
        ].map((match) => unxml(match[1]));
        const selected = company.vouchers.filter((voucher) => {
          if (delta && !(voucher.alterId > BigInt(delta[1]) && voucher.alterId <= BigInt(delta[2])))
            return false;
          if (
            days &&
            !quirks.ignoreDates &&
            !(dayNumber(voucher.date) >= days[1] && dayNumber(voucher.date) <= days[2])
          )
            return false;
          if (typeNames.length && !typeNames.includes(voucher.type)) return false;
          return true;
        });
        const child = /<REPEAT>ShivL2 : (\w+)<\/REPEAT>/.exec(body)?.[1];
        const count = selected.length;
        let out;
        if (child === 'AllLedgerEntries')
          out = selected.flatMap((voucher) =>
            (voucher.isCancelled ? [] : voucher.lines).map((line) => [
              voucher.guid,
              line.ledger,
              amount(line.amount),
            ]),
          );
        else if (child === 'AllInventoryEntries')
          out = selected.flatMap((voucher) =>
            (voucher.isCancelled ? [] : voucher.items).map((item) => [
              voucher.guid,
              item.item,
              item.qty,
              item.rate,
              amount(item.amount),
            ]),
          );
        else if (body.includes('$MasterId'))
          out = selected.map((voucher) => [
            voucher.guid,
            voucher.masterId,
            String(voucher.alterId),
            voucher.date,
            voucher.type,
            voucher.number,
            voucher.party,
            voucher.reference,
            voucher.narration,
            yesNo(voucher.isOptional),
            yesNo(voucher.isCancelled),
          ]);
        else out = selected.map((voucher) => [voucher.guid, String(voucher.alterId), voucher.date]);
        out.count = count;
        return out;
      }
      default:
        return [];
    }
  }
}
