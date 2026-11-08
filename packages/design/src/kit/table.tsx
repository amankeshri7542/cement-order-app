'use client';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import {
  getCoreRowModel,
  getExpandedRowModel,
  getGroupedRowModel,
  useReactTable,
  type ColumnDef,
  type ExpandedState,
  type Row,
  type RowSelectionState,
} from '@tanstack/react-table';
import { useVirtualizer, useWindowVirtualizer } from '@tanstack/react-virtual';
import { Button, IconButton } from './actions';
import { DateText, MoneyText, QtyText } from './data';
import { formatCount, moveRow } from './format';
import { Checkbox } from './inputs';
import kit from './kit.module.css';
import { useKitWords } from './words';

export type ColumnKind = 'text' | 'money' | 'qty' | 'date' | 'status' | 'actions';
/** Where a column goes on a phone: the name on the left, the figure on the right, a line below. */
export type PhoneRole = 'primary' | 'figure' | 'secondary' | 'hidden';

export type Column<T> = {
  id: string;
  header: string;
  /** Sets alignment, format and the phone role (DESIGN.md, DataTable). */
  kind?: ColumnKind;
  /** The plain value: for sorting keys, subtotals, grouping and the cell when `cell` is absent. */
  value?: (row: T) => string | number | null | undefined;
  /** A cell of its own (a stamp, a link). */
  cell?: (row: T) => ReactNode;
  /** Money in paise kept exact (galla, bills, khata); otherwise whole rupees. */
  exact?: boolean;
  /** Qty: the unit as stored for this row. */
  unit?: (row: T) => string | undefined;
  /** The server can sort by this column; its id is the sort key. */
  sortable?: boolean;
  /** Add this column up in group subtotals and in the total row. Money and qty only. */
  total?: boolean;
  phone?: PhoneRole;
  /** A CSS width such as "8rem". */
  width?: string;
};

export type SortState = { id: string; desc: boolean } | null;
export type RowMenuItem = { label: string; onSelect: () => void; danger?: boolean };

type Props<T> = {
  /** Names the table for screen readers. */
  label: string;
  rows: readonly T[];
  columns: readonly Column<T>[];
  rowId: (row: T) => string;
  /** Said in "Select {name}" and "More for {name}". */
  rowName: (row: T) => string;
  state?: 'loading' | 'error' | 'ready';
  onRetry?: () => void;
  empty: { title: string; action?: ReactNode };
  /** Server sort: the table only asks; the page fetches the sorted page. */
  sort?: SortState;
  onSortChange?: (sort: SortState) => void;
  /** Group by this column, with a subtotal per group. Rows must arrive in group order. */
  groupBy?: string;
  /** Totals of the whole filter from the server. Without them, the loaded rows are added up. */
  totals?: Partial<Record<string, number>>;
  showTotals?: boolean;
  onOpen?: (row: T) => void;
  /** Quiet actions shown on the row (on hover or focus on a laptop). */
  rowActions?: (row: T) => ReactNode;
  rowMenu?: (row: T) => readonly RowMenuItem[];
  /** Multi-select: the ids chosen, kept by the page so they survive a refetch. */
  selected?: ReadonlySet<string>;
  onSelectedChange?: (next: Set<string>) => void;
  bulkActions?: (ids: string[]) => ReactNode;
  /** CSV of the current filter, built by the server. */
  exportHref?: string;
  /** `auto` switches to two-line rows below 600 px. */
  layout?: 'auto' | 'table' | 'list';
  /** Rows above this many are virtualised. */
  virtualAbove?: number;
  /** Height of the table's own scroll area on a laptop. */
  height?: string;
};

type Item<T> =
  | { type: 'group'; row: Row<T>; key: string }
  | { type: 'row'; row: Row<T>; key: string; at: number }
  | { type: 'subtotal'; row: Row<T>; key: string };

const numeric = (kind?: ColumnKind) => kind === 'money' || kind === 'qty';

function defaultRole(column: Column<unknown>, index: number): PhoneRole {
  if (column.phone) return column.phone;
  if (column.kind === 'actions') return 'hidden';
  if (column.kind === 'money') return 'figure';
  return index === 0 ? 'primary' : 'secondary';
}

/** The phone layout below 600 px, decided after the first paint (the server draws the table). */
function usePhone(layout: 'auto' | 'table' | 'list') {
  const [phone, setPhone] = useState(layout === 'list');
  useEffect(() => {
    if (layout !== 'auto') {
      setPhone(layout === 'list');
      return;
    }
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(max-width: 599.98px)');
    setPhone(query.matches);
    const change = () => setPhone(query.matches);
    query.addEventListener('change', change);
    return () => query.removeEventListener('change', change);
  }, [layout]);
  return phone;
}

function rootPx() {
  if (typeof window === 'undefined') return 16;
  return parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
}

/** A CSV link goes to this site or the API over http(s), never to a script. */
function safeHref(href: string) {
  try {
    const url = new URL(href, 'https://desk.invalid/');
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

/**
 * A drawn row's real height. A table in a hidden tab measures 0; counting that as 0 would draw all
 * 10,000 rows at once, so it counts as the estimate until the row is really on screen.
 */
function measured(element: Element, estimate: number) {
  const height = element.getBoundingClientRect().height;
  return height > 0 ? height : estimate;
}

function CellValue<T>({ column, row }: { column: Column<T>; row: T }) {
  if (column.cell) return <>{column.cell(row)}</>;
  const value = column.value?.(row);
  if (value === null || value === undefined || value === '')
    return <span aria-hidden="true">—</span>;
  if (column.kind === 'money')
    return <MoneyText value={Number(value)} exact={column.exact ?? false} strong={false} />;
  if (column.kind === 'qty') return <QtyText value={Number(value)} unit={column.unit?.(row)} />;
  if (column.kind === 'date') return <DateText value={String(value)} />;
  return <>{String(value)}</>;
}

function SumValue<T>({ column, value }: { column: Column<T>; value: number | undefined }) {
  if (value === undefined || !Number.isFinite(value)) return null;
  return column.kind === 'qty' ? (
    <QtyText value={value} />
  ) : (
    <MoneyText value={value} exact={column.exact ?? false} />
  );
}

function RowMenu({ name, items }: { name: string; items: readonly RowMenuItem[] }) {
  const say = useKitWords();
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    box.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  if (!items.length) return null;
  return (
    <span ref={box} className={kit.menuBox}>
      <IconButton
        label={say('kit.table.rowMenu', { name })}
        icon="⋮"
        size="sm"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={(event) => {
          event.stopPropagation();
          setOpen(!open);
        }}
        onKeyDown={(event) => event.stopPropagation()}
      />
      {open && (
        <ul
          id={menuId}
          role="menu"
          className={kit.menu}
          onKeyDown={(event) => {
            event.stopPropagation();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
            );
            const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
            if (event.key === 'Escape') {
              setOpen(false);
              box.current?.querySelector<HTMLButtonElement>('button')?.focus();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              buttons[(at + 1) % buttons.length]?.focus();
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              buttons[(at - 1 + buttons.length) % buttons.length]?.focus();
            }
          }}
        >
          {items.map((item) => (
            <li key={item.label} role="none">
              <button
                type="button"
                role="menuitem"
                className={`${kit.menuItem} ${item.danger ? kit.menuDanger : ''}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setOpen(false);
                  item.onSelect();
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}

/**
 * The ledger table (DESIGN.md, DataTable): one column definition renders a sortable, grouped,
 * virtualised table on a laptop and two-line rows on a phone. Sorting, filtering and paging happen
 * on the server; this component shows a page of rows and says what the person asked for.
 */
export function DataTable<T>(props: Props<T>) {
  const {
    label,
    rows,
    columns,
    rowId,
    state = 'ready',
    onRetry,
    empty,
    groupBy,
    selected,
    onSelectedChange,
    bulkActions,
    exportHref,
    layout = 'auto',
  } = props;
  const say = useKitWords();
  const phone = usePhone(layout);
  const selectable = !!onSelectedChange;

  const defs = useMemo<ColumnDef<T>[]>(
    () =>
      columns.map((column) => ({
        id: column.id,
        header: column.header,
        accessorFn: (row: T) => column.value?.(row) ?? null,
        enableGrouping: column.id === groupBy,
        aggregationFn: column.total && numeric(column.kind) ? 'sum' : undefined,
      })),
    [columns, groupBy],
  );
  const [expanded, setExpanded] = useState<ExpandedState>(true);
  const rowSelection = useMemo<RowSelectionState>(
    () => Object.fromEntries([...(selected ?? [])].map((id) => [id, true])),
    [selected],
  );
  const table = useReactTable({
    data: rows as T[],
    columns: defs,
    getRowId: (row) => rowId(row),
    getCoreRowModel: getCoreRowModel(),
    getGroupedRowModel: groupBy ? getGroupedRowModel() : undefined,
    getExpandedRowModel: getExpandedRowModel(),
    manualSorting: true,
    manualPagination: true,
    manualFiltering: true,
    groupedColumnMode: false,
    // Groups stay as the person left them: choosing a row or a new page must not fold them all.
    autoResetExpanded: false,
    initialState: { expanded: true },
    state: { grouping: groupBy ? [groupBy] : [], expanded, rowSelection },
    onExpandedChange: setExpanded,
    enableRowSelection: (row) => !row.getIsGrouped(),
    onRowSelectionChange: (updater) => {
      const next = typeof updater === 'function' ? updater(rowSelection) : updater;
      onSelectedChange?.(new Set(Object.keys(next).filter((id) => next[id])));
    },
  });

  // Group headers, rows and subtotals as one list, so the virtualiser and the keyboard share it.
  const items = useMemo(() => {
    const out: Item<T>[] = [];
    let at = 0;
    const all = table.getRowModel().rows;
    for (let index = 0; index < all.length; index++) {
      const row = all[index]!;
      if (row.getIsGrouped()) {
        out.push({ type: 'group', row, key: `g:${row.id}` });
        if (!row.getIsExpanded()) out.push({ type: 'subtotal', row, key: `s:${row.id}` });
        continue;
      }
      out.push({ type: 'row', row, key: row.id, at: at++ });
      const next = all[index + 1];
      const parent = row.getParentRow();
      if (parent && (!next || next.getParentRow()?.id !== parent.id))
        out.push({ type: 'subtotal', row: parent, key: `s:${parent.id}` });
    }
    return out;
  }, [table, rows, groupBy, expanded]);
  const leaves = useMemo(
    () => items.filter((item): item is Extract<Item<T>, { type: 'row' }> => item.type === 'row'),
    [items],
  );

  const totals = useMemo(() => {
    const out: Record<string, number> = {};
    for (const column of columns) {
      if (!column.total || !numeric(column.kind)) continue;
      const given = props.totals?.[column.id];
      out[column.id] =
        given ?? rows.reduce((sum, row) => sum + (Number(column.value?.(row)) || 0), 0);
    }
    return out;
  }, [columns, rows, props.totals]);
  const showTotals = (props.showTotals ?? Object.keys(totals).length > 0) && rows.length > 0;

  // Only rows on screen count: a chosen row that a refetch or a filter took away is never acted on.
  const chosenIds = useMemo(
    () => leaves.filter((item) => selected?.has(item.row.id)).map((item) => item.row.id),
    [leaves, selected],
  );
  const chosen = chosenIds.length;
  const ids = useCallback(() => chosenIds, [chosenIds]);
  const href = exportHref && safeHref(exportHref) ? exportHref : undefined;

  if (state === 'loading')
    return (
      <div className={kit.tableState} role="status" aria-label={say('kit.busy')}>
        {Array.from({ length: 6 }, (_, index) => (
          <span key={index} className={kit.skeletonRow} />
        ))}
      </div>
    );
  if (state === 'error')
    return (
      <div className={kit.tableState} role="alert">
        <p>{say('kit.table.error')}</p>
        {onRetry && (
          <Button type="button" variant="secondary" onClick={onRetry}>
            {say('kit.retry')}
          </Button>
        )}
      </div>
    );
  if (!rows.length)
    return (
      <div className={kit.tableState}>
        <p className={kit.emptyTitle}>{empty.title}</p>
        {empty.action}
      </div>
    );

  const toolbar =
    (selectable && chosen > 0) || href ? (
      <div className={kit.tableBar} role="region" aria-label={label}>
        {selectable && chosen > 0 ? (
          <>
            <span className={kit.figure} aria-live="polite">
              {say('kit.table.selected', { count: formatCount(chosen) })}
            </span>
            {bulkActions?.(ids())}
            <Button
              type="button"
              variant="quiet"
              size="sm"
              onClick={() => onSelectedChange?.(new Set())}
            >
              {say('kit.table.clearSelection')}
            </Button>
          </>
        ) : (
          href && (
            <a className={kit.exportLink} href={href} download>
              {say('kit.table.export')}
            </a>
          )
        )}
      </div>
    ) : null;

  return (
    <div className={kit.tableWrap}>
      {toolbar}
      {phone ? (
        <PhoneList
          {...props}
          items={items}
          leaves={leaves}
          totals={totals}
          showTotals={showTotals}
          table={table}
        />
      ) : (
        <LedgerTable
          {...props}
          items={items}
          leaves={leaves}
          totals={totals}
          showTotals={showTotals}
          table={table}
        />
      )}
      <p className={kit.hidden}>{say('kit.table.keys')}</p>
    </div>
  );
}

type Inner<T> = Props<T> & {
  items: Item<T>[];
  leaves: Extract<Item<T>, { type: 'row' }>[];
  totals: Record<string, number>;
  showTotals: boolean;
  table: ReturnType<typeof useReactTable<T>>;
};

/** Keyboard on the rows: arrows move, Enter opens, x selects (DESIGN.md). Focus is roving. */
function useRowKeys<T>(
  props: Inner<T>,
  scrollTo: (itemIndex: number) => void,
  find: (rowIndex: number) => HTMLElement | null,
) {
  const [active, setActive] = useState(-1);
  const pending = useRef(false);
  const { leaves, items, onOpen, onSelectedChange, selected } = props;
  useEffect(() => {
    if (active >= leaves.length) setActive(leaves.length ? leaves.length - 1 : -1);
  }, [leaves.length, active]);
  useEffect(() => {
    if (!pending.current || active < 0) return;
    const element = find(active);
    if (element) {
      element.focus({ preventScroll: false });
      pending.current = false;
    } else {
      // A virtual row not drawn yet: bring it into view, then focus it on the next paint.
      const item = leaves[active];
      if (item) scrollTo(items.indexOf(item));
      requestAnimationFrame(() => {
        const later = find(active);
        if (later) {
          later.focus();
          pending.current = false;
        }
      });
    }
  });
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, rowIndex: number) => {
    const item = leaves[rowIndex];
    if (!item) return;
    if (event.key === 'Enter' && onOpen) {
      event.preventDefault();
      onOpen(item.row.original);
      return;
    }
    if (
      (event.key === 'x' || event.key === 'X') &&
      onSelectedChange &&
      !event.metaKey &&
      !event.ctrlKey
    ) {
      event.preventDefault();
      const next = new Set(selected ?? []);
      if (next.has(item.row.id)) next.delete(item.row.id);
      else next.add(item.row.id);
      onSelectedChange(next);
      return;
    }
    const target = moveRow(event.key, rowIndex, leaves.length);
    if (
      target !== rowIndex &&
      ['ArrowDown', 'ArrowUp', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)
    ) {
      event.preventDefault();
      pending.current = true;
      setActive(target);
    }
  };
  return { active: active < 0 ? 0 : active, setActive, onKeyDown };
}

function HeaderCell<T>({
  column,
  props,
  first,
}: {
  column: Column<T>;
  props: Inner<T>;
  first: boolean;
}) {
  const say = useKitWords();
  const { sort, onSortChange } = props;
  const sorted = sort?.id === column.id ? (sort.desc ? 'descending' : 'ascending') : undefined;
  const classes = [
    numeric(column.kind) ? kit.num : '',
    column.kind === 'money' ? kit.ruleBefore : '',
    first ? kit.stickyFirst : '',
    column.kind === 'actions' ? kit.actionsCell : '',
  ].join(' ');
  return (
    <th
      scope="col"
      className={classes}
      style={column.width ? { width: column.width } : undefined}
      aria-sort={sorted ?? (column.sortable && onSortChange ? 'none' : undefined)}
    >
      {column.sortable && onSortChange ? (
        <button
          type="button"
          className={kit.sortButton}
          aria-label={say('kit.table.sortBy', { name: column.header })}
          onClick={() =>
            onSortChange(
              sort?.id === column.id
                ? { id: column.id, desc: !sort.desc }
                : { id: column.id, desc: numeric(column.kind) },
            )
          }
        >
          <span>{column.header}</span>
          <span aria-hidden="true" className={kit.sortMark}>
            {sorted === 'ascending' ? '▲' : sorted === 'descending' ? '▼' : '↕'}
          </span>
        </button>
      ) : column.kind === 'actions' ? (
        <span className={kit.hidden}>{column.header}</span>
      ) : (
        column.header
      )}
    </th>
  );
}

function LedgerTable<T>(props: Inner<T>) {
  const say = useKitWords();
  const {
    columns,
    items,
    leaves,
    label,
    rowName,
    onOpen,
    rowActions,
    rowMenu,
    selected,
    onSelectedChange,
    table,
  } = props;
  const selectable = !!onSelectedChange;
  const scroller = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const virtual = items.length > (props.virtualAbove ?? 200);
  const rowPx = Math.round(rootPx() * 2.25);
  const virtualizer = useVirtualizer({
    count: virtual ? items.length : 0,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowPx,
    overscan: 12,
    initialRect: { width: 1024, height: 640 },
    measureElement: (element) => measured(element, rowPx),
  });
  const drawn = virtual ? virtualizer.getVirtualItems() : null;
  const keys = useRowKeys(
    props,
    (index) => virtualizer.scrollToIndex(index, { align: 'auto' }),
    (rowIndex) => body.current?.querySelector<HTMLElement>(`[data-row="${rowIndex}"]`) ?? null,
  );
  const allChosen = leaves.length > 0 && leaves.every((item) => selected?.has(item.row.id));
  const someChosen = !allChosen && leaves.some((item) => selected?.has(item.row.id));
  const span = columns.length + (selectable ? 1 : 0);

  const renderItem = (item: Item<T>, index: number) => {
    if (item.type === 'group') {
      const open = item.row.getIsExpanded();
      const name = String(item.row.groupingValue ?? '');
      return (
        <tr
          key={item.key}
          data-index={index}
          ref={virtual ? virtualizer.measureElement : undefined}
          className={kit.groupRow}
        >
          <th scope="rowgroup" colSpan={span} className={kit.stickyFirst}>
            <button
              type="button"
              className={kit.groupToggle}
              aria-expanded={open}
              aria-label={say(open ? 'kit.table.hideGroup' : 'kit.table.showGroup', { name })}
              onClick={() => item.row.toggleExpanded()}
            >
              <span aria-hidden="true">{open ? '▾' : '▸'}</span>
              <span>{name}</span>
              <span className={kit.groupCount}>
                {say('kit.table.groupRows', { count: formatCount(item.row.subRows.length) })}
              </span>
            </button>
          </th>
        </tr>
      );
    }
    if (item.type === 'subtotal') {
      const name = String(item.row.groupingValue ?? '');
      return (
        <tr
          key={item.key}
          data-index={index}
          ref={virtual ? virtualizer.measureElement : undefined}
          className={kit.subtotalRow}
        >
          {selectable && <td />}
          {columns.map((column, at) => (
            <td
              key={column.id}
              className={`${numeric(column.kind) ? kit.num : ''} ${column.kind === 'money' ? kit.ruleBefore : ''} ${at === 0 ? kit.stickyFirst : ''}`}
            >
              {at === 0 ? (
                <span className={kit.subtotalLabel}>{`${name} · ${say('kit.table.total')}`}</span>
              ) : column.total && numeric(column.kind) ? (
                <SumValue column={column} value={Number(item.row.getValue(column.id))} />
              ) : null}
            </td>
          ))}
        </tr>
      );
    }
    const row = item.row;
    const original = row.original;
    const name = rowName(original);
    const chosen = selected?.has(row.id) ?? false;
    return (
      <tr
        key={item.key}
        data-index={index}
        data-row={item.at}
        ref={virtual ? virtualizer.measureElement : undefined}
        tabIndex={item.at === keys.active ? 0 : -1}
        aria-selected={selectable ? chosen : undefined}
        className={`${kit.dataRow} ${onOpen ? kit.openable : ''}`}
        onFocus={() => keys.setActive(item.at)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          keys.onKeyDown(event, item.at);
        }}
        onClick={(event) => {
          if (!onOpen) return;
          if ((event.target as HTMLElement).closest('button, a, input, label, [role="menu"]'))
            return;
          onOpen(original);
        }}
      >
        {selectable && (
          <td className={kit.selectCell}>
            <Checkbox
              label={say('kit.table.selectRow', { name })}
              hideLabel
              checked={chosen}
              onChange={() => row.toggleSelected()}
            />
          </td>
        )}
        {columns.map((column, at) => (
          <td
            key={column.id}
            className={[
              numeric(column.kind) ? kit.num : '',
              column.kind === 'money' ? kit.ruleBefore : '',
              at === 0 ? kit.stickyFirst : '',
              column.kind === 'actions' ? kit.actionsCell : '',
            ].join(' ')}
          >
            {column.kind === 'actions' ? (
              <span className={kit.rowActions}>
                {rowActions?.(original)}
                {rowMenu && <RowMenu name={name} items={rowMenu(original)} />}
              </span>
            ) : (
              <CellValue column={column} row={original} />
            )}
          </td>
        ))}
      </tr>
    );
  };

  const before = drawn && drawn.length ? drawn[0]!.start : 0;
  const after =
    drawn && drawn.length ? virtualizer.getTotalSize() - drawn[drawn.length - 1]!.end : 0;
  return (
    <div
      ref={scroller}
      className={`${kit.tableScroll} ${virtual ? kit.tableScrollFixed : ''}`}
      style={props.height ? { maxBlockSize: props.height } : undefined}
      tabIndex={-1}
    >
      <table
        className={kit.table}
        aria-label={label}
        aria-rowcount={virtual ? items.length + 1 : undefined}
      >
        <thead>
          <tr>
            {selectable && (
              <th scope="col" className={kit.selectCell}>
                <Checkbox
                  label={say('kit.table.selectAll')}
                  hideLabel
                  checked={allChosen}
                  indeterminate={someChosen}
                  onChange={(on) => table.toggleAllRowsSelected(on)}
                />
              </th>
            )}
            {columns.map((column, at) => (
              <HeaderCell key={column.id} column={column} props={props} first={at === 0} />
            ))}
          </tr>
        </thead>
        <tbody ref={body}>
          {before > 0 && (
            <tr aria-hidden="true" className={kit.spacer}>
              <td colSpan={span} style={{ blockSize: before }} />
            </tr>
          )}
          {drawn
            ? drawn.map((entry) => (
                <Fragment key={entry.key}>{renderItem(items[entry.index]!, entry.index)}</Fragment>
              ))
            : items.map((item, index) => renderItem(item, index))}
          {after > 0 && (
            <tr aria-hidden="true" className={kit.spacer}>
              <td colSpan={span} style={{ blockSize: after }} />
            </tr>
          )}
        </tbody>
        {props.showTotals && (
          <tfoot>
            <tr className={kit.totalRow}>
              {selectable && <td />}
              {columns.map((column, at) => (
                <td
                  key={column.id}
                  className={`${numeric(column.kind) ? kit.num : ''} ${column.kind === 'money' ? kit.ruleBefore : ''} ${at === 0 ? kit.stickyFirst : ''}`}
                >
                  {at === 0 ? (
                    <strong>{say('kit.table.total')}</strong>
                  ) : column.id in props.totals ? (
                    <SumValue column={column} value={props.totals[column.id]} />
                  ) : null}
                </td>
              ))}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

/** Two-line rows on a phone: the name left, the figure right, the rest below (DESIGN.md). */
function PhoneList<T>(props: Inner<T>) {
  const say = useKitWords();
  const { columns, items, label, rowName, onOpen, rowMenu, selected, onSelectedChange } = props;
  const selectable = !!onSelectedChange;
  const list = useRef<HTMLUListElement>(null);
  const [margin, setMargin] = useState(0);
  useEffect(() => {
    const top = list.current?.getBoundingClientRect().top ?? 0;
    setMargin(top + window.scrollY);
  }, []);
  const virtual = items.length > (props.virtualAbove ?? 200);
  const virtualizer = useWindowVirtualizer({
    count: virtual ? items.length : 0,
    estimateSize: () => Math.round(rootPx() * 4),
    measureElement: (element) => measured(element, Math.round(rootPx() * 4)),
    overscan: 8,
    scrollMargin: margin,
    initialRect: { width: 390, height: 800 },
  });
  const drawn = virtual ? virtualizer.getVirtualItems() : null;
  const keys = useRowKeys(
    props,
    (index) => virtualizer.scrollToIndex(index, { align: 'auto' }),
    (rowIndex) => list.current?.querySelector<HTMLElement>(`[data-row="${rowIndex}"]`) ?? null,
  );
  const roles = columns.map((column, index) => defaultRole(column as Column<unknown>, index));
  const primary = columns.find((_, index) => roles[index] === 'primary') ?? columns[0]!;
  const figure = columns.find((_, index) => roles[index] === 'figure');
  const secondary = columns.filter((_, index) => roles[index] === 'secondary');

  const renderItem = (item: Item<T>, index: number) => {
    const style = drawn
      ? {
          transform: `translateY(${(drawn.find((entry) => entry.index === index)?.start ?? 0) - margin}px)`,
        }
      : undefined;
    const common = {
      'data-index': index,
      ref: virtual ? virtualizer.measureElement : undefined,
      style,
    };
    if (item.type === 'group') {
      const open = item.row.getIsExpanded();
      const name = String(item.row.groupingValue ?? '');
      return (
        <li key={item.key} {...common} className={`${kit.phoneGroup} ${drawn ? kit.placed : ''}`}>
          <button
            type="button"
            className={kit.groupToggle}
            aria-expanded={open}
            aria-label={say(open ? 'kit.table.hideGroup' : 'kit.table.showGroup', { name })}
            onClick={() => item.row.toggleExpanded()}
          >
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
            <span>{name}</span>
            <span className={kit.groupCount}>
              {say('kit.table.groupRows', { count: formatCount(item.row.subRows.length) })}
            </span>
          </button>
        </li>
      );
    }
    if (item.type === 'subtotal') {
      const name = String(item.row.groupingValue ?? '');
      const sum = figure && figure.total ? Number(item.row.getValue(figure.id)) : undefined;
      return (
        <li
          key={item.key}
          {...common}
          className={`${kit.phoneSubtotal} ${drawn ? kit.placed : ''}`}
        >
          <span>{`${name} · ${say('kit.table.total')}`}</span>
          {figure && <SumValue column={figure} value={sum} />}
        </li>
      );
    }
    const original = item.row.original;
    const name = rowName(original);
    const chosen = selected?.has(item.row.id) ?? false;
    return (
      <li
        key={item.key}
        {...common}
        data-row={item.at}
        tabIndex={item.at === keys.active ? 0 : -1}
        aria-selected={selectable ? chosen : undefined}
        className={`${kit.phoneRow} ${onOpen ? kit.openable : ''} ${drawn ? kit.placed : ''}`}
        onFocus={() => keys.setActive(item.at)}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          keys.onKeyDown(event, item.at);
        }}
        onClick={(event) => {
          if (!onOpen) return;
          if ((event.target as HTMLElement).closest('button, a, input, label, [role="menu"]'))
            return;
          onOpen(original);
        }}
      >
        {selectable && (
          <Checkbox
            label={say('kit.table.selectRow', { name })}
            hideLabel
            checked={chosen}
            onChange={() => item.row.toggleSelected()}
          />
        )}
        <span className={kit.phoneMain}>
          <span className={kit.phonePrimary}>
            <CellValue column={primary} row={original} />
          </span>
          {secondary.length > 0 && (
            <span className={kit.phoneSecondary}>
              {secondary.map((column, at) => (
                <span key={column.id}>
                  {at > 0 && <span aria-hidden="true"> · </span>}
                  <CellValue column={column} row={original} />
                </span>
              ))}
            </span>
          )}
        </span>
        {figure && (
          <span className={kit.phoneFigure}>
            <CellValue column={figure} row={original} />
          </span>
        )}
        {rowMenu && <RowMenu name={name} items={rowMenu(original)} />}
      </li>
    );
  };

  return (
    <>
      <ul
        ref={list}
        className={kit.phoneList}
        aria-label={label}
        style={drawn ? { blockSize: virtualizer.getTotalSize(), position: 'relative' } : undefined}
      >
        {drawn
          ? drawn.map((entry) => (
              <Fragment key={entry.key}>{renderItem(items[entry.index]!, entry.index)}</Fragment>
            ))
          : items.map((item, index) => renderItem(item, index))}
      </ul>
      {props.showTotals && figure && figure.id in props.totals && (
        <div className={kit.phoneTotal}>
          <strong>{say('kit.table.total')}</strong>
          <SumValue column={figure} value={props.totals[figure.id]} />
        </div>
      )}
    </>
  );
}
