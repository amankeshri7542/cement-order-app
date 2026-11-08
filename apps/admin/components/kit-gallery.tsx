'use client';
import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Combobox,
  DataTable,
  DateInput,
  DateText,
  FilterBar,
  FilterChip,
  IconButton,
  Kbd,
  KpiTile,
  LedgerTotal,
  MoneyInput,
  MoneyText,
  NumberInput,
  Pager,
  QtyStepper,
  QtyText,
  SearchBox,
  Segmented,
  Select,
  StatusStamp,
  Switch,
  TextInput,
  stamps,
  type Column,
  type ComboOption,
  type SortState,
  type StampKind,
} from '@shiv/design';
import { istToday } from '@shiv/shared';
import { LanguageProvider } from '../lib/i18n';
import css from './kit-gallery.module.css';

// Sample rows only: made-up materials, no shop data. Section names are component names, for the
// people checking the kit; the parts themselves speak the page's language.
type Sample = {
  id: string;
  name: string;
  category: string;
  stock: number;
  rate: number;
  due: number;
  stamp: StampKind;
};
const kinds = ['Cement', 'Sariya', 'Balu', 'Gitti', 'Eent'];
const makers = ['Nirmaan', 'Sthir', 'Pakki', 'Majboot', 'Sona'];
const units: Record<string, string> = {
  Cement: 'bori',
  Sariya: 'kg',
  Balu: 'cft',
  Gitti: 'cft',
  Eent: 'pcs',
};
const stampKinds = Object.keys(stamps) as StampKind[];

function sampleRows(count: number): Sample[] {
  return Array.from({ length: count }, (_, index) => {
    const category = kinds[Math.floor((index * kinds.length) / count) % kinds.length]!;
    return {
      id: `s${index}`,
      name: `${makers[index % makers.length]} ${category} ${index + 1}`,
      category,
      stock: (index * 37) % 400,
      rate: 5000 + ((index * 1373) % 45000),
      due: index % 3 ? 0 : ((index * 9173) % 900000) + 100,
      stamp: stampKinds[index % stampKinds.length]!,
    };
  });
}

const columns: Column<Sample>[] = [
  { id: 'name', header: 'Name', value: (row) => row.name, sortable: true, width: '16rem' },
  { id: 'category', header: 'Category', value: (row) => row.category, phone: 'secondary' },
  {
    id: 'stock',
    header: 'Stock',
    kind: 'qty',
    value: (row) => row.stock,
    unit: (row) => units[row.category],
    total: true,
    sortable: true,
    phone: 'secondary',
  },
  {
    id: 'rate',
    header: 'Rate',
    kind: 'money',
    value: (row) => row.rate,
    sortable: true,
    phone: 'hidden',
  },
  {
    id: 'due',
    header: 'Due',
    kind: 'money',
    exact: true,
    value: (row) => row.due,
    total: true,
    sortable: true,
  },
  {
    id: 'stamp',
    header: 'Status',
    kind: 'status',
    cell: (row) => <StatusStamp kind={row.stamp} />,
    phone: 'secondary',
  },
  { id: 'actions', header: 'Actions', kind: 'actions' },
];

const people: ComboOption[] = sampleRows(40).map((row) => ({
  id: row.id,
  label: `Grahak ${row.id.slice(1)}`,
  hint: `98${String(10000000 + Number(row.id.slice(1)) * 7919).slice(0, 8)}`,
}));

export function KitGallery() {
  return (
    <LanguageProvider>
      <Gallery />
    </LanguageProvider>
  );
}

function Gallery() {
  const [count, setCount] = useState(60);
  useEffect(() => {
    const asked = Number(new URLSearchParams(window.location.search).get('rows'));
    if (Number.isInteger(asked) && asked > 0 && asked <= 10000) setCount(asked);
  }, []);
  const all = useMemo(() => sampleRows(count), [count]);
  const [query, setQuery] = useState('');
  const [lowOnly, setLowOnly] = useState(false);
  const [dueOnly, setDueOnly] = useState(false);
  const [shop, setShop] = useState<'all' | 'main' | 'godown'>('all');
  const [sort, setSort] = useState<SortState>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [grouped, setGrouped] = useState(true);
  const [opened, setOpened] = useState('');
  // The page plays the server: it filters and sorts, then sends the table a page and the totals.
  const filtered = useMemo(() => {
    const typed = query.trim().toLowerCase();
    let out = all.filter(
      (row) =>
        (!typed || row.name.toLowerCase().includes(typed)) &&
        (!lowOnly || row.stock < 40) &&
        (!dueOnly || row.due > 0),
    );
    if (sort) {
      const key = sort.id as keyof Sample;
      out = [...out].sort((a, b) => {
        const left = a[key];
        const right = b[key];
        const order =
          typeof left === 'number'
            ? left - (right as number)
            : String(left).localeCompare(String(right));
        return sort.desc ? -order : order;
      });
    }
    if (grouped)
      out = [...out].sort((a, b) => kinds.indexOf(a.category) - kinds.indexOf(b.category));
    return out;
  }, [all, query, lowOnly, dueOnly, sort, grouped]);
  const totals = useMemo(
    () => ({
      stock: filtered.reduce((sum, row) => sum + row.stock, 0),
      due: filtered.reduce((sum, row) => sum + row.due, 0),
    }),
    [filtered],
  );
  const low = all.filter((row) => row.stock < 40).length;
  const owing = all.filter((row) => row.due > 0).length;

  const [text, setText] = useState('');
  const [qty, setQty] = useState<number | null>(12);
  const [paise, setPaise] = useState<number | null>(125050);
  const [select, setSelect] = useState('main');
  const [on, setOn] = useState(true);
  const [check, setCheck] = useState(false);
  const [day, setDay] = useState(istToday());
  const [person, setPerson] = useState<ComboOption | null>(null);
  const [step, setStep] = useState(5);

  return (
    <main className={css.page} id="kit">
      <h1>Kit</h1>

      <section aria-labelledby="k-buttons" className={css.section}>
        <h2 id="k-buttons">Button</h2>
        <div className={css.row}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="quiet">Quiet</Button>
          <Button variant="danger">Danger</Button>
          <Button variant="secondary" size="sm">
            Small
          </Button>
          <Button loading>Loading</Button>
          <IconButton label="Menu" icon="⋮" />
          <Kbd>/</Kbd>
        </div>
      </section>

      <section aria-labelledby="k-inputs" className={css.section}>
        <h2 id="k-inputs">Inputs</h2>
        <div className={css.grid}>
          <TextInput label="TextInput" value={text} onChange={setText} hint="Hint" />
          <TextInput label="TextInput error" value="12" onChange={() => {}} error="Error text" />
          <NumberInput label="NumberInput" value={qty} onChange={setQty} min={0} unit="bori" />
          <MoneyInput label="MoneyInput" value={paise} onChange={setPaise} />
          <Select
            label="Select"
            value={select}
            onChange={setSelect}
            options={[
              { value: 'main', label: 'Main' },
              { value: 'godown', label: 'Godown' },
            ]}
          />
          <Combobox label="Combobox" value={person} onSelect={setPerson} options={people} />
          <DateInput label="DateInput" value={day} onChange={setDay} />
          <div className={css.stack}>
            <Switch label="Switch" checked={on} onChange={setOn} />
            <Checkbox label="Checkbox" checked={check} onChange={setCheck} />
            <QtyStepper
              label="QtyStepper"
              value={step}
              onChange={setStep}
              decreaseLabel="Less"
              increaseLabel="More"
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="k-data" className={css.section}>
        <h2 id="k-data">Data</h2>
        <div className={css.row}>
          {stampKinds.map((kind) => (
            <StatusStamp key={kind} kind={kind} />
          ))}
        </div>
        <div className={css.row}>
          <MoneyText value={12345650} />
          <MoneyText value={12345650} exact={false} />
          <MoneyText value={0} zero="dash" />
          <MoneyText value={50000} signed />
          <MoneyText value={-50000} signed />
          <QtyText value={1250} unit="bori" />
          <DateText value={day} />
        </div>
        <LedgerTotal label="LedgerTotal" value={totals.due} />
      </section>

      <section aria-labelledby="k-table" className={css.section}>
        <h2 id="k-table">DataTable</h2>
        <div className={css.kpis}>
          <KpiTile label="Rows" kind="count" value={filtered.length} />
          <KpiTile
            label="Low stock"
            kind="count"
            value={low}
            selected={lowOnly}
            onSelect={() => setLowOnly(!lowOnly)}
          />
          <KpiTile
            label="Due"
            value={totals.due}
            before={totals.due * 0.9}
            goodWhen="down"
            trend={[4, 6, 5, 8, 7, 9]}
            selected={dueOnly}
            onSelect={() => setDueOnly(!dueOnly)}
          />
        </div>
        <FilterBar
          label="Filters"
          search={<SearchBox label="Search" value={query} onChange={setQuery} />}
          chips={
            <>
              <FilterChip label="Low" count={low} pressed={lowOnly} onChange={setLowOnly} />
              <FilterChip label="Due" count={owing} pressed={dueOnly} onChange={setDueOnly} />
            </>
          }
          controls={
            <Segmented
              label="Shop"
              value={shop}
              onChange={setShop}
              options={[
                { value: 'all', label: 'All' },
                { value: 'main', label: 'Main' },
                { value: 'godown', label: 'Godown' },
              ]}
            />
          }
          end={<Switch label="Group" checked={grouped} onChange={setGrouped} />}
        />
        <DataTable
          label="Sample stock"
          rows={filtered}
          columns={columns}
          rowId={(row) => row.id}
          rowName={(row) => row.name}
          empty={{ title: 'Empty' }}
          sort={sort}
          onSortChange={setSort}
          groupBy={grouped ? 'category' : undefined}
          totals={totals}
          selected={selected}
          onSelectedChange={setSelected}
          bulkActions={(ids) => (
            <Button type="button" variant="secondary" size="sm">
              Bulk {ids.length}
            </Button>
          )}
          onOpen={(row) => setOpened(row.name)}
          rowActions={(row) => (
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => setOpened(`edit ${row.name}`)}
            >
              Edit
            </Button>
          )}
          rowMenu={(row) => [
            { label: 'Open', onSelect: () => setOpened(row.name) },
            { label: 'Remove', onSelect: () => setOpened(`remove ${row.name}`), danger: true },
          ]}
          exportHref="#csv"
        />
        <Pager
          offset={0}
          shown={filtered.length}
          total={{ value: filtered.length, exact: true }}
          onNext={undefined}
        />
        <output data-testid="opened">{opened}</output>
      </section>
    </main>
  );
}
