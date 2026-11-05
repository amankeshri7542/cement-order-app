// The fixed list of requests this program can ever send to Tally: plan 09 section 7, and nothing else.
// A job names a read here and gives values. The server cannot send TDL, and cannot change a field.
// Every request is an Export. There is no import, alter, delete or write of any kind in this program.

const textEscape = (value) =>
  String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const xmlEscape = (value) => textEscape(value).replace(/"/g, '&quot;').replace(/'/g, '&apos;');

const AMT = (x) =>
  `$$StringFindAndReplace:(if $$IsDebit:$${x} then -$$NumValue:$${x} else $$NumValue:$${x}):"(-)":"-"`;
const DATE = (x) => `$$PyrlYYYYMMDDFormat:$${x}:"-"`;
const NUM = (d) => `(($$YearOfDate:$${d})*10000+($$MonthOfDate:$${d})*100+$$DayOfDate:$${d})`;

const companyFields = [
  '$Guid',
  '$Name',
  DATE('BooksFrom'),
  DATE('LastVoucherDate'),
  '$AltMstId',
  '$AltVchId',
];
const voucherCollection = (fetch, filters) =>
  `<TYPE>Voucher</TYPE><FETCH>${fetch}</FETCH>${filters.length ? `<FILTER>${filters.join(',')}</FILTER>` : ''}`;

/** The dozen reads. `fields` are the <SET> of F01, F02...; `child` explodes a second part per voucher. */
const READS = Object.freeze({
  companies: { named: false, collection: () => '<TYPE>Company</TYPE>', fields: companyFields },
  licence: {
    named: false,
    collection: () => '<TYPE>Company</TYPE>',
    fields: [
      '$$ProdInfo:ProdMajorVersion',
      '$$ProdInfo:ProdMinorVersion',
      '$$ProdInfo:ProdReleaseAsStr',
      '$$LicenseInfo:IsEducationalMode',
      '$$LicenseInfo:IsLicensedMode',
      '$$LicenseInfo:IsSilver',
      '$$LicenseInfo:IsGold',
      '$$IsEditLogOn',
    ],
  },
  groups: {
    named: true,
    collection: () => '<TYPE>Group</TYPE>',
    fields: ['$Guid', '$AlterId', '$Name', '$Parent'],
  },
  parties: {
    named: true,
    collection: (params) =>
      `<TYPE>Ledger</TYPE><CHILDOF>${partyGroup(params.group)}</CHILDOF><BELONGSTO>Yes</BELONGSTO>`,
    fields: [
      '$Guid',
      '$MasterId',
      '$AlterId',
      '$Name',
      '$Parent',
      '$LedgerMobile',
      '$LedgerPhone',
      '$PartyGSTIN',
      '$IsBillWiseOn',
      AMT('OpeningBalance'),
      AMT('ClosingBalance'),
    ],
  },
  voucherTypes: {
    named: true,
    collection: () => '<TYPE>VoucherType</TYPE>',
    fields: ['$Guid', '$Name', '$Parent'],
  },
  stockItems: {
    named: true,
    collection: () => '<TYPE>StockItem</TYPE>',
    fields: [
      '$Guid',
      '$AlterId',
      '$Name',
      '$Parent',
      '$BaseUnits',
      '$ClosingBalance',
      AMT('ClosingValue'),
    ],
  },
  godowns: {
    named: true,
    collection: () => '<TYPE>Godown</TYPE>',
    fields: ['$Guid', '$Name', '$Parent'],
  },
  vouchers: {
    named: true,
    collection: (params) =>
      voucherCollection('AlterId,Narration,PartyLedgerName,Reference', voucherFilters(params)),
    formulas: voucherFormulas,
    fields: [
      '$Guid',
      '$MasterId',
      '$AlterId',
      DATE('Date'),
      '$VoucherTypeName',
      '$VoucherNumber',
      '$PartyLedgerName',
      '$Reference',
      '$Narration',
      '$IsOptional',
      '$IsCancelled',
    ],
  },
  voucherLines: {
    named: true,
    collection: (params) => voucherCollection('AllLedgerEntries', voucherFilters(params)),
    formulas: voucherFormulas,
    child: 'AllLedgerEntries',
    fields: ['$Guid', '$LedgerName', AMT('Amount')],
  },
  voucherStock: {
    named: true,
    collection: (params) => voucherCollection('AllInventoryEntries', voucherFilters(params)),
    formulas: voucherFormulas,
    child: 'AllInventoryEntries',
    fields: ['$Guid', '$StockItemName', '$BilledQty', '$Rate', AMT('Amount')],
  },
  voucherSweep: {
    named: true,
    collection: (params) => voucherCollection('AlterId', voucherFilters(params)),
    formulas: voucherFormulas,
    fields: ['$Guid', '$AlterId', DATE('Date')],
  },
});

export const readNames = Object.freeze(Object.keys(READS));

export class BadJob extends Error {}

// ---- Values from the server. Each is checked here, so a hacked API cannot reach TDL through one. ----

const plain = (value, what, max = 200) => {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new BadJob(`${what} is not usable`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new BadJob(`${what} has control characters`);
  return value;
};
function partyGroup(group) {
  if (group !== 'Sundry Debtors' && group !== 'Sundry Creditors')
    throw new BadJob('Only debtors or creditors can be read');
  return group;
}
const tallyDateText = (value, what) => {
  if (typeof value !== 'string' || !/^\d{1,2}-[A-Z][a-z]{2}-\d{4}$/.test(value))
    throw new BadJob(`${what} is not a date`);
  return value;
};
const digits = (value, what, max = 18) => {
  if (typeof value !== 'string' || !new RegExp(`^\\d{1,${max}}$`).test(value))
    throw new BadJob(`${what} is not a number`);
  return value;
};
function typeNames(types) {
  if (!Array.isArray(types) || !types.length || types.length > 80)
    throw new BadJob('Voucher types are not usable');
  return types.map((name) => {
    const text = plain(name, 'Voucher type', 120);
    // A quote mark would end the string inside the formula, and the rest would run as TDL.
    if (text.includes('"')) throw new BadJob('Voucher type has a quote mark');
    return text;
  });
}
function voucherFilters(params) {
  return [
    ...(params.after !== undefined ? ['ShivDelta'] : []),
    ...(params.dayFrom !== undefined ? ['ShivDay'] : []),
    ...(params.types !== undefined ? ['ShivTypes'] : []),
  ];
}
function voucherFormulas(params) {
  const out = [];
  if (params.after !== undefined) {
    const after = digits(params.after, 'after');
    const upto = digits(params.upto, 'upto');
    out.push(['ShivDelta', `$AlterId > ${after} AND $AlterId <= ${upto}`]);
  }
  if (params.dayFrom !== undefined) {
    const from = digits(params.dayFrom, 'dayFrom', 8);
    const to = digits(params.dayTo, 'dayTo', 8);
    out.push(['ShivDay', `${NUM('Date')} >= ${from} AND ${NUM('Date')} <= ${to}`]);
  }
  if (params.types !== undefined)
    out.push([
      'ShivTypes',
      typeNames(params.types)
        .map((name) => `$VoucherTypeName = "${name}"`)
        .join(' OR '),
    ]);
  return out;
}

const fieldTags = (fields) =>
  fields
    .map((set, index) => {
      const tag = `F${String(index + 1).padStart(2, '0')}`;
      return `<FIELD NAME="${tag}"><SET>${textEscape(set)}</SET><XMLTAG>${tag}</XMLTAG></FIELD>`;
    })
    .join('');
const fieldNames = (fields) =>
  fields.map((_, index) => `F${String(index + 1).padStart(2, '0')}`).join(',');

/**
 * The exact XML for one read, or its count (read 12: one field, $$NumItems of the same collection).
 * Throws BadJob for anything outside the list.
 */
export function buildRead(name, params = {}, { count = false } = {}) {
  if (!Object.hasOwn(READS, name)) throw new BadJob('Not one of the fixed reads');
  const read = READS[name];
  const statics = ['<SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT>'];
  if (read.named)
    statics.push(
      `<SVCURRENTCOMPANY>${xmlEscape(plain(params.company, 'Company', 300))}</SVCURRENTCOMPANY>`,
    );
  if (params.fromDate !== undefined)
    statics.push(
      `<SVFROMDATE TYPE="Date">${tallyDateText(params.fromDate, 'fromDate')}</SVFROMDATE>`,
    );
  if (params.toDate !== undefined)
    statics.push(`<SVTODATE TYPE="Date">${tallyDateText(params.toDate, 'toDate')}</SVTODATE>`);
  const formulas = (read.formulas ? read.formulas(params) : [])
    .map(([key, text]) => `<SYSTEM TYPE="Formulae" NAME="${key}">${textEscape(text)}</SYSTEM>`)
    .join('');
  const collection = `<COLLECTION NAME="ShivC">${read.collection(params)}</COLLECTION>`;
  let parts;
  if (count) {
    parts =
      '<PART NAME="ShivP"><LINES>ShivL</LINES></PART><LINE NAME="ShivL"><FIELDS>F01</FIELDS></LINE>' +
      fieldTags(['$$NumItems:ShivC']);
  } else if (read.child) {
    parts =
      '<PART NAME="ShivP"><LINES>ShivL</LINES><REPEAT>ShivL : ShivC</REPEAT><SCROLLED>Vertical</SCROLLED></PART>' +
      '<LINE NAME="ShivL"><FIELDS>FldBlank</FIELDS><EXPLODE>ShivP2</EXPLODE></LINE>' +
      '<FIELD NAME="FldBlank"><SET>""</SET><XMLTAG>FLDBLANK</XMLTAG></FIELD>' +
      `<PART NAME="ShivP2"><LINES>ShivL2</LINES><REPEAT>ShivL2 : ${read.child}</REPEAT><SCROLLED>Vertical</SCROLLED></PART>` +
      `<LINE NAME="ShivL2"><FIELDS>${fieldNames(read.fields)}</FIELDS></LINE>` +
      fieldTags(read.fields);
  } else {
    parts =
      '<PART NAME="ShivP"><LINES>ShivL</LINES><REPEAT>ShivL : ShivC</REPEAT><SCROLLED>Vertical</SCROLLED></PART>' +
      `<LINE NAME="ShivL"><FIELDS>${fieldNames(read.fields)}</FIELDS></LINE>` +
      fieldTags(read.fields);
  }
  return (
    '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Data</TYPE><ID>ShivR</ID></HEADER>' +
    `<BODY><DESC><STATICVARIABLES>${statics.join('')}</STATICVARIABLES><TDL><TDLMESSAGE>` +
    '<REPORT NAME="ShivR"><FORMS>ShivF</FORMS></REPORT><FORM NAME="ShivF"><PARTS>ShivP</PARTS></FORM>' +
    `${parts}${collection}${formulas}</TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>`
  );
}

/** Plan 09: when read 1 answers empty, Tally's own list still says what it knows, with none loaded. */
export function buildCompanyList() {
  return (
    '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>List of Companies</ID></HEADER>' +
    '<BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES></DESC></BODY></ENVELOPE>'
  );
}

/**
 * The last gate before anything leaves for Tally, whoever called. A request must be our own Export,
 * and may hold none of the words Tally's write path needs. A test proves this on every read.
 */
export function assertReadOnly(xml) {
  if (!/^<ENVELOPE><HEADER><VERSION>1<\/VERSION><TALLYREQUEST>Export<\/TALLYREQUEST>/.test(xml))
    throw new BadJob('Only an Export may be sent to Tally');
  // Values are escaped, so these can only appear as real tags or attributes if something is wrong.
  if (
    /<TALLYMESSAGE|<IMPORTDATA|<IMPORT\b|ACTION=|<VOUCHER\b|REMOTEID|TALLYREQUEST>Import/i.test(xml)
  )
    throw new BadJob('A write cannot be sent to Tally');
  return xml;
}

/** Tally answers in the request's encoding, and ledger names may be in Devanagari. */
export const encodeRequest = (xml) => Buffer.from(assertReadOnly(xml), 'utf16le');
export const requestHeaders = { 'Content-Type': 'text/xml;charset=utf-16' };
